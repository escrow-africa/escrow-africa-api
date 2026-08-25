export interface Faq {
  id: string;
  question: string;
  answer: string;
  category: 'escrow' | 'wallet' | 'disputes' | 'account';
}

export const FAQS: Faq[] = [
  {
    id: 'what-is-escrow',
    category: 'escrow',
    question: 'How does an escrow transaction work?',
    answer:
      'The buyer funds the escrow, the seller delivers, and once the inspection period passes without a dispute, funds are released to the seller automatically.',
  },
  {
    id: 'fund-escrow',
    category: 'wallet',
    question: 'How do I fund my wallet?',
    answer: 'Go to Wallet > Fund Wallet and choose bank transfer, USSD, or card payment.',
  },
  {
    id: 'open-dispute',
    category: 'disputes',
    question: 'What happens if I open a dispute?',
    answer:
      'The related escrow is locked, both parties can submit evidence and message a mediator, and the funds stay held until the dispute is resolved.',
  },
  {
    id: 'payout-accounts',
    category: 'wallet',
    question: 'How do I add a bank account for payouts?',
    answer: 'Go to Settings > Payout Methods to add or set a default bank account.',
  },
  {
    id: 'change-password',
    category: 'account',
    question: 'How do I change my password?',
    answer: 'Go to Settings > Security and use the change password form.',
  },
];
