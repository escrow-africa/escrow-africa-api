import { Injectable, Logger } from '@nestjs/common';
import axios from 'axios';
import { v4 as uuidv4 } from 'uuid';
import * as crypto from 'crypto';

@Injectable()
export class MonnifyService {
  private readonly logger = new Logger(MonnifyService.name);
  private token: string | null = null;
  private tokenExpiry = 0;

  private async withRetries<T>(fn: () => Promise<T>, attempts = 3, baseDelayMs = 300): Promise<T> {
    let lastErr: any;
    for (let i = 0; i < attempts; i++) {
      try {
        return await fn();
      } catch (e) {
        lastErr = e;
        const wait = baseDelayMs * Math.pow(2, i);
        this.logger.warn(`Monnify call failed (attempt ${i + 1}/${attempts}), retrying in ${wait}ms`, e?.response?.data || e?.message || e);
        await new Promise((r) => setTimeout(r, wait));
      }
    }
    throw lastErr;
  }

  private getBaseUrl() {
    return process.env.MONNIFY_BASE_URL;
  }

  verifySignature(rawBody: string | Buffer, signatureHeader?: string | string[]) {
    const secret = this.getSecretKey();
    if (!secret) return false;
    const body = typeof rawBody === 'string' ? rawBody : rawBody.toString('utf8');

    const hmac = crypto.createHmac('sha512', secret).update(body).digest();
    const hex = hmac.toString('hex');
    const b64 = hmac.toString('base64');

    if (!signatureHeader) return false;
    const sig = Array.isArray(signatureHeader) ? signatureHeader[0] : signatureHeader;
    const normalized = String(sig).trim();
    if (!normalized) return false;

    // Accept either hex or base64 encoded signatures
    if (normalized === hex) return true;
    if (normalized === b64) return true;

    // Sometimes header may be prefixed like "sha512=..."
    const maybe = normalized.replace(/^sha512=/i, '').replace(/^hmac=/i, '');
    if (maybe === hex || maybe === b64) return true;
    return false;
  }

  private getApiKey() {
    return process.env.MONNIFY_API_KEY;
  }

  private getSecretKey() {
    return process.env.MONNIFY_SECRET_KEY;
  }

  private async getAccessToken(): Promise<string> {
    const now = Date.now();
    if (this.token && now < this.tokenExpiry) return this.token;

    const url = `${this.getBaseUrl()}/auth/login`;

    const apiKey = this.getApiKey();
    const secretKey = this.getSecretKey();

    const encoded = Buffer.from(`${apiKey}:${secretKey}`).toString('base64');

    this.logger.debug('Requesting Monnify access token', { url });
    const resp = await this.withRetries(async () => {
      try {
        return await axios.post(url, {}, {
          headers: {
            Authorization: `Basic ${encoded}`,
            'Content-Type': 'application/json'
          }
        });
      } catch (e: any) {
        this.logger.error('Monnify token request error', e?.response?.status, e?.response?.data || e?.message);
        throw e;
      }
    });
    const data = resp.data;
    const accessToken = data?.responseBody?.accessToken || data?.response?.accessToken;
    const expiresIn = data?.responseBody?.expiresIn || data?.response?.expiresIn || 300;
    this.token = accessToken;
    this.tokenExpiry = Date.now() + (expiresIn - 60) * 1000;
    return this.token!;
  }

  async initializeTransaction(userId: string, amount: number, customer?: { name?: string; email?: string }) {
    const token = await this.getAccessToken();
    const paymentReference = `${userId}-${uuidv4()}`;
    const url = `${this.getBaseUrl()}/merchant/transactions/init-transaction`;
    const payload: any = {
      paymentReference,
      amount,
      currencyCode: 'NGN',
      customerEmail: customer?.email ,
      contractCode: process.env.MONNIFY_CONTRACT_CODE,
      paymentMethods: ['CARD', 'ACCOUNT_TRANSFER', 'USSD', 'PHONE_NUMBER'],
      paymentDescription: `Wallet top-up for ${userId}`,
      metadata: { name: customer?.name, userId },
    };

    // Remove undefined keys
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    this.logger.debug('Initializing Monnify transaction', { url, paymentReference, amount });
    const resp = await this.withRetries(async () => {
      try {
        return await axios.post(url, payload, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
      } catch (e: any) {
        this.logger.error('Monnify init transaction error', e?.response?.status, e?.response?.data || e?.message);
        throw e;
      }
    });
    // return provider response plus our paymentReference so caller can track
    return {
      providerResponse: resp.data,
      paymentReference,
    };
  }

  // Fetch list of banks (reference data)
  async getBanks(): Promise<any> {
    const token = await this.getAccessToken();
    const url = `${this.getBaseUrl()}/banks`;
    this.logger.debug('Fetching banks list', { url });
    const resp = await this.withRetries(async () => {
      try {
        return await axios.get(url, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
      } catch (e: any) {
        this.logger.error('Monnify getBanks error', e?.response?.status, e?.response?.data || e?.message);
        throw e;
      }
    });
    return resp.data?.responseBody || resp.data;
  }

  // Initialize bank transfer / USSD payment - returns account details and/or USSD code
  async initBankPayment(transactionReference: string, bankCode: string) {
    const token = await this.getAccessToken();
    const url = `${this.getBaseUrl()}/merchant/bank-transfer/init-payment`;
    const payload = { transactionReference, bankCode };
    this.logger.debug('Initializing bank transfer', { url, transactionReference, bankCode });
    const resp = await this.withRetries(async () => {
      try {
        return await axios.post(url, payload, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
      } catch (e: any) {
        this.logger.error('Monnify initBankPayment error', e?.response?.status, e?.response?.data || e?.message);
        throw e;
      }
    });

    const body = resp.data?.responseBody || resp.data;
    // normalize expected fields: accountNumber, accountName, bankName, bankCode, ussdCode, paymentReference
    return {
      providerResponse: resp.data,
      accountNumber: body?.accountNumber || body?.account_number || body?.accountNo,
      accountName: body?.accountName || body?.account_name,
      bankName: body?.bankName || body?.bank_name || body?.bank,
      bankCode: body?.bankCode || body?.bank_code,
      ussdCode: body?.ussdCode || body?.ussd_code || body?.ussd,
      providerReference: body?.transactionReference || body?.paymentReference || body?.reference,
      raw: body,
    };
  }

  // Charge a card using Monnify cards charge endpoint
  async chargeCard(
    transactionReference: string,
    card: { number: string; expiryMonth: string; expiryYear: string; pin?: string; cvv?: string },
    deviceInformation: any,
    collectionChannel = 'API_NOTIFICATION',
  ) {
    const token = await this.getAccessToken();
    const url = `${this.getBaseUrl()}/merchant/cards/charge`;
    const payload: any = {
      transactionReference,
      collectionChannel,
      card,
      deviceInformation,
    };
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
    // Mask card for logs
    const masked = { ...card, number: `****${card.number?.slice(-4)}` };
    this.logger.debug('Charging card', { url, transactionReference, card: masked });
    const resp = await this.withRetries(async () => {
      try {
        return await axios.post(url, payload, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
      } catch (e: any) {
        this.logger.error('Monnify chargeCard error', e?.response?.status, e?.response?.data || e?.message);
        throw e;
      }
    });
    const body = resp.data?.responseBody || resp.data;
    return {
      providerResponse: resp.data,
      providerReference: body?.transactionReference || body?.paymentReference || body?.reference,
      requiresOtp: !!body?.authenticationRequired || !!body?.requiresAuthentication || false,
      tokenId: body?.tokenId || body?.token_id || body?.data?.tokenId,
      raw: body,
    };
  }

  // Authorize card OTP
  async authorizeCardOtp(tokenId: string, token: string, transactionReference?: string, collectionChannel = 'API_NOTIFICATION') {
    const accessToken = await this.getAccessToken();
    const url = `${this.getBaseUrl()}/merchant/cards/otp/authorize`;
    const payload: any = {
      transactionReference,
      collectionChannel,
      tokenId,
      token,
    };
    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);
    this.logger.debug('Authorizing card OTP', { url, tokenId, transactionReference });
    const resp = await this.withRetries(async () => {
      try {
        return await axios.post(url, payload, { headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' } });
      } catch (e: any) {
        this.logger.error('Monnify authorizeCardOtp error', e?.response?.status, e?.response?.data || e?.message);
        throw e;
      }
    });
    const body = resp.data?.responseBody || resp.data;
    return {
      providerResponse: resp.data,
      providerReference: body?.transactionReference || body?.paymentReference || body?.reference,
      status: body?.status || body?.paymentStatus || undefined,
      raw: body,
    };
  }

  async createReservedAccount(userId: string, customer?: { name?: string; email?: string }) {
    const token = await this.getAccessToken();
    const accountReference = `${userId}-${uuidv4()}`;
    const url = `${this.getBaseUrl()}/bank-transfer/reserved-accounts`;

    const payload: any = {
      accountReference,
      accountName: customer?.name || userId,
      currencyCode: 'NGN',
      contractCode: process.env.MONNIFY_CONTRACT_CODE,
      customerName: customer?.name,
      customerEmail: customer?.email,
      getAllAvailableBanks: false,
    };

    console.log('Creating Monnify reserved account with payload', payload);

    Object.keys(payload).forEach((k) => payload[k] === undefined && delete payload[k]);

    this.logger.debug('Creating Monnify reserved account', { url, accountReference, token });

    const resp = await this.withRetries(async () => {
      try {
        return await axios.post(url, payload, { headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' } });
      } catch (e: any) {
        this.logger.error('Monnify create reserved account error', e?.response?.status, e?.response?.data || e?.message);
        throw e?.response?.data || e?.message || e;
      }
    });

    // Typical response contains accountNumber, accountName, bankName, bankCode, accountReference
    const body = resp.data?.responseBody || resp.data;
    const accountNumber = body?.accountNumber || body?.account_number || body?.accountNo;
    const accountName = body?.accountName || body?.account_name;
    const bankName = body?.bankName || body?.bank_name || body?.bank;
    const bankCode = body?.bankCode || body?.bank_code;

    return {
      providerResponse: resp.data,
      accountReference,
      accountNumber,
      accountName,
      bankName,
      bankCode,
    };
  }

  async parseWebhook(payload: any) {
    // Monnify structures vary; common fields: paymentReference, transactionReference, amountPaid, paymentStatus
    const providerReference = payload?.paymentReference || payload?.transactionReference || payload?.reference;
    const amount = payload?.amountPaid || payload?.amount || payload?.transactionAmount;
    const status = (payload?.paymentStatus || payload?.status || payload?.payment_status || '').toUpperCase();
    return { providerReference, amount, status, raw: payload };
  }
}
