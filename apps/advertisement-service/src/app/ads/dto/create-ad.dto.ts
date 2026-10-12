export class CreateAdDto {
  productTitle!: string;
  description?: string;
  basePrice!: number;
  coverImage?: string;
  promotionPlacementSlot!: string;
  industry!: string;
  targetAudience!: string;
  startDate!: string;
  endDate!: string;
  billingDailyBudget!: number;
  allocatedBudgetLimit!: number;
  badgeLabel?: string;
  presentationTheme?: string;
}
