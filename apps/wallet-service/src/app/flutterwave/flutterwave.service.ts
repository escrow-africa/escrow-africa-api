import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import * as crypto from 'crypto';
import { v4 as uuidv4 } from 'uuid';

@Injectable()
export class FlutterwaveService {
  private readonly logger = new Logger(FlutterwaveService.name);

  private async withRetries<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 300): Promise<T> {
    let lastErr: any;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e: any) {
        lastErr = e;
        const wait = baseDelayMs * Math.pow(2, i);
        this.logger.warn(`Flutterwave call failed (attempt ${i + 1}/${attempts}), retrying in ${wait}ms`, e?.response?.data || e?.message || e);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr;
  }

  private getBaseUrl() {
    return process.env.FLUTTERWAVE_BASE_URL || 'https://api.flutterwave.com/v3';
  }

  private getSecretKey() {
    return process.env.FLUTTERWAVE_SECRET_KEY;
  }

  private headers() {
    return { Authorization: `Bearer ${this.getSecretKey()}`, 'Content-Type': 'application/json' };
  }

  // Direct card charges are the one Flutterwave call that carries raw PAN/CVV, so the whole
  // payload must be 3DES-ECB encrypted with the merchant's Encryption Key (Settings > API in the
  // dashboard - a separate 24-byte credential from the secret key) and sent as { client: <b64> }.
  // Matches Flutterwave's documented node-forge example exactly, using Node's built-in crypto.
  private encryptCardPayload(payload: any): string {
    const key = process.env.FLUTTERWAVE_ENCRYPTION_KEY;
    if (!key) throw new Error('FLUTTERWAVE_ENCRYPTION_KEY is not configured - required for card charges');
    const cipher = crypto.createCipheriv('des-ede3', Buffer.from(key, 'utf8'), null as any);
    const text = JSON.stringify(payload);
    let encrypted = cipher.update(text, 'utf8', 'base64');
    encrypted += cipher.final('base64');
    return encrypted;
  }

  // Flutterwave's webhook signature isn't a computed HMAC like Monnify's - it's a static
  // secret hash you configure in the dashboard, which Flutterwave echoes back verbatim in the
  // "verif-hash" header on every webhook call. Verification is a plain string comparison.
  verifySignature(signatureHeader?: string | string[]) {
    const expected = process.env.FLUTTERWAVE_WEBHOOK_SECRET_HASH;
    if (!expected || !signatureHeader) return false;
    const sig = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    return String(sig).trim() === expected;
  }

  // Unlike Monnify (separate init-transaction call to open a transactionReference before you can
  // charge), Flutterwave needs no server round-trip to "start" a transaction - tx_ref is just a
  // reference string the caller generates. Kept as its own method so wallet.service.ts's existing
  // two-step flow (initialize, then charge) doesn't need restructuring.
  async initializeTransaction(userId: string, amount: number, customer?: { name?: string; email?: string }) {
    const paymentReference = `${userId}-${uuidv4()}`;
    return {
      providerResponse: { responseBody: { transactionReference: paymentReference } },
      paymentReference,
    };
  }

  async getBanks(): Promise<any> {
    const url = `${this.getBaseUrl()}/banks/NG`;
    this.logger.debug('Fetching banks list', { url });
    const resp = await this.withRetries(async () => {
      try {
        return await axios.get(url, { headers: this.headers() });
      } catch (e: any) {
        this.logger.error('Flutterwave getBanks error', e?.response?.status, e?.response?.data || e?.message);
        throw e;
      }
    });
    return resp.data?.data || resp.data;
  }

  // One-time dynamic virtual account scoped to a single transaction/amount - no BVN/NIN required,
  // unlike the permanent account created at registration. Mirrors Monnify's initBankPayment role.
  async initBankPayment(
    transactionReference: string,
    _bankCode: string | undefined,
    amount: number,
    customer?: { name?: string; email?: string },
  ) {
    const url = `${this.getBaseUrl()}/charges?type=bank_transfer`;
    const payload = {
      tx_ref: transactionReference,
      amount,
      currency: 'NGN',
      email: customer?.email,
      fullname: customer?.name,
    };
    this.logger.debug('Initializing Flutterwave bank transfer charge', { url, transactionReference, amount });
    const resp = await this.withRetries(async () => {
      try {
        return await axios.post(url, payload, { headers: this.headers() });
      } catch (e: any) {
        this.logger.error('Flutterwave bank transfer charge error', e?.response?.status, e?.response?.data || e?.message);
        throw e;
      }
    });

    const body = resp.data?.data || resp.data;
    return {
      providerResponse: resp.data,
      accountNumber: body?.account_number,
      accountName: customer?.name,
      bankName: body?.bank_name,
      bankCode: undefined,
      ussdCode: undefined,
      providerReference: body?.flw_ref || transactionReference,
      raw: body,
    };
  }

  // Direct card charge - Flutterwave combines "initialize" and "charge" into one call. The OTP
  // step (if required) is completed separately via authorizeCardOtp/validate-charge below.
  async chargeCard(
    transactionReference: string,
    card: { number: string; expiryMonth: string; expiryYear: string; pin?: string; cvv?: string },
    _deviceInformation: any,
    amount: number,
    customer?: { name?: string; email?: string },
  ) {
    const url = `${this.getBaseUrl()}/charges?type=card`;
    const plainPayload: any = {
      tx_ref: transactionReference,
      amount,
      currency: 'NGN',
      email: customer?.email,
      fullname: customer?.name,
      card_number: card.number,
      cvv: card.cvv,
      expiry_month: card.expiryMonth,
      expiry_year: card.expiryYear,
      // Flutterwave evaluates the card first; cards needing a PIN expect it nested under
      // "authorization" (not a flat "pin" field) - sending it flat gets a response back asking
      // for the exact same thing again under meta.authorization.
      authorization: card.pin ? { mode: 'pin', pin: card.pin } : undefined,
    };
    Object.keys(plainPayload).forEach((k) => plainPayload[k] === undefined && delete plainPayload[k]);
    const payload = { client: this.encryptCardPayload(plainPayload) };

    const masked = { ...card, number: `****${card.number?.slice(-4)}` };
    this.logger.debug('Charging card via Flutterwave', { url, transactionReference, card: masked });
    const resp = await this.withRetries(async () => {
      try {
        return await axios.post(url, payload, { headers: this.headers() });
      } catch (e: any) {
        this.logger.error('Flutterwave chargeCard error', e?.response?.status, e?.response?.data || e?.message);
        throw e;
      }
    });

    const body = resp.data?.data || resp.data;
    // Flutterwave evaluates the card and tells us which of three authorization models it needs
    // (we only find out after this call, regardless of what we sent): "pin" (resubmit with the
    // nested authorization object - see retryWithPin flow), "otp" (validate separately via
    // validate-charge, below), or "redirect" (3D-Secure/VBV - the cardholder must complete a
    // hosted verification page; there is no code to collect, final status arrives via webhook).
    const authMode = body?.meta?.authorization?.mode;
    return {
      providerResponse: resp.data,
      providerReference: body?.flw_ref || body?.tx_ref || transactionReference,
      status: body?.status,
      authorizationMode: authMode as 'pin' | 'otp' | 'redirect' | undefined,
      redirectUrl: authMode === 'redirect' ? body?.meta?.authorization?.redirect : undefined,
      requiresOtp: authMode === 'otp',
      // flw_ref doubles as the reference the OTP validation step needs, kept under the same
      // `tokenId` field name Monnify used so wallet.service.ts's call sites don't change.
      tokenId: body?.flw_ref,
      raw: body,
    };
  }

  // Flutterwave's OTP completion step for a pending card charge.
  async authorizeCardOtp(tokenId: string, token: string, transactionReference?: string) {
    const url = `${this.getBaseUrl()}/validate-charge`;
    const payload = { otp: token, flw_ref: tokenId };
    this.logger.debug('Validating Flutterwave card OTP', { url, tokenId, transactionReference });
    const resp = await this.withRetries(async () => {
      try {
        return await axios.post(url, payload, { headers: this.headers() });
      } catch (e: any) {
        this.logger.error('Flutterwave authorizeCardOtp error', e?.response?.status, e?.response?.data || e?.message);
        throw e;
      }
    });

    const body = resp.data?.data || resp.data;
    return {
      providerResponse: resp.data,
      providerReference: body?.flw_ref || body?.tx_ref || transactionReference,
      status: body?.status,
      raw: body,
    };
  }

  // Permanent NGN virtual account for a user's wallet - requires a BVN or NIN per Flutterwave's
  // compliance rules for static accounts. Mirrors Monnify's createReservedAccount role.
  async createVirtualAccount(userId: string, customer?: { name?: string; email?: string; phone?: string; bvn?: string }) {
    if (!customer?.bvn) {
      throw new Error('BVN or NIN is required to create a permanent Flutterwave virtual account');
    }

    const accountReference = `${userId}-${uuidv4()}`;
    const url = `${this.getBaseUrl()}/virtual-account-numbers`;
    const payload: any = {
      email: customer.email,
      tx_ref: accountReference,
      is_permanent: true,
      bvn: customer.bvn,
      phonenumber: customer.phone,
      firstname: customer.name?.split(' ')[0],
      lastname: customer.name?.split(' ').slice(1).join(' ') || customer.name?.split(' ')[0],
      narration: customer.name || userId,
    };
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    this.logger.debug('Creating Flutterwave permanent virtual account', { url, accountReference });
    const resp = await this.withRetries(async () => {
      try {
        return await axios.post(url, payload, { headers: this.headers() });
      } catch (e: any) {
        this.logger.error('Flutterwave create virtual account error', e?.response?.status, e?.response?.data || e?.message);
        throw e?.response?.data || e?.message || e;
      }
    });

    const body = resp.data?.data || resp.data;
    return {
      providerResponse: resp.data,
      accountReference,
      accountNumber: body?.account_number,
      accountName: customer.name,
      bankName: body?.bank_name,
      bankCode: undefined,
    };
  }

  // Disburses funds to an external bank account (NGN only). Status comes back NEW/PENDING
  // immediately - final SUCCESSFUL/FAILED confirmation arrives later via webhook.
  async initiateTransfer(
    reference: string,
    amount: number,
    destination: { bankCode: string; accountNumber: string; accountName?: string },
  ) {
    const url = `${this.getBaseUrl()}/transfers`;
    const payload = {
      account_bank: destination.bankCode,
      account_number: destination.accountNumber,
      amount,
      currency: 'NGN',
      narration: 'Escrow Africa wallet withdrawal',
      reference,
    };

    this.logger.debug('Initiating Flutterwave transfer', { url, reference, amount });
    const resp = await this.withRetries(async () => {
      try {
        return await axios.post(url, payload, { headers: this.headers() });
      } catch (e: any) {
        this.logger.error('Flutterwave initiateTransfer error', e?.response?.status, e?.response?.data || e?.message);
        throw e;
      }
    });

    const body = resp.data?.data || resp.data;
    return {
      providerResponse: resp.data,
      transferId: body?.id,
      status: body?.status,
      raw: body,
    };
  }

  async parseWebhook(payload: any) {
    // Confirmed against a real Flutterwave sandbox webhook delivery: a charge/collection event
    // arrives with camelCase fields (txRef/flwRef) at the top level, not nested under `data`
    // with snake_case names as Flutterwave's own docs example shows for charge.completed.
    // Transfer events (payouts/withdrawals) use a different field entirely - `reference`, which
    // is the exact string we generated and sent when creating the transfer. Checking all of
    // these makes this resilient to whichever shape actually arrives for either event type.
    const data = payload?.data || payload;
    const providerReference = data?.reference || data?.tx_ref || data?.txRef || data?.flw_ref || data?.flwRef;
    const amount = data?.amount;
    const status = String(data?.status || '').toUpperCase();
    return { providerReference, amount, status, raw: payload };
  }
}
