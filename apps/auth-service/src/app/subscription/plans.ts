export interface SubscriptionPlan {
  id: 'free' | 'pro' | 'premium';
  tier: 'FREE' | 'PRO' | 'PREMIUM';
  name: string;
  price: number;
  priceDisplay: string;
  description: string;
  benefits: string[];
}

export const SUBSCRIPTION_PLANS: SubscriptionPlan[] = [
  {
    id: 'free',
    tier: 'FREE',
    name: 'Free (Default)',
    price: 0,
    priceDisplay: '₦0',
    description: 'Standard secure custodian safeguards.',
    benefits: [
      '1.5% Escrow commission fee',
      'Standard mediation queue (72h response)',
      'Max escrow volume ₦750,000 per contract',
      'Email ticket support',
    ],
  },
  {
    id: 'pro',
    tier: 'PRO',
    name: 'Pro Safeguard',
    price: 20000,
    priceDisplay: '₦20000',
    description: 'Optimal for active builders & agencies.',
    benefits: [
      '0.8% Escrow commission fee',
      'Express mediation ticket triage (24h)',
      'Max escrow volume ₦10,000,000 per contract',
      'Automatic custom NDA legal drafts',
      'Priority Slack ticket integrations',
    ],
  },
  {
    id: 'premium',
    tier: 'PREMIUM',
    name: 'Premium Enterprise',
    price: 50000,
    priceDisplay: '₦50000',
    description: 'Elite zero-commission broker tier.',
    benefits: [
      '0.0% Custom commission fees (Enterprise)',
      'Direct 24/7 Legal Mediation Hotline',
      'Unlimited escrow contract limits',
      'Dedicated account lawyer assigned to legal drafts',
      'White-label broker escrow contracts',
    ],
  },
];

export function findPlan(planId: string): SubscriptionPlan | undefined {
  return SUBSCRIPTION_PLANS.find((p) => p.id === planId);
}
