import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class RegisterDto {
  @IsNotEmpty()
  @IsString()
  firstName!: string;

  @IsNotEmpty()
  @IsString()
  lastName!: string;

  @IsEmail()
  email!: string;

  @IsNotEmpty()
  phone!: string;

  @IsNotEmpty()
  createPassword!: string;

  @IsNotEmpty()
  confirmPassword!: string;

  @IsOptional()
  @IsString()
  referralCode?: string;

  // Required by the payment provider (Flutterwave) to create a permanent NGN virtual account
  // for this user's wallet. Accepts either an 11-digit BVN or NIN.
  @IsNotEmpty()
  @Matches(/^\d{11}$/, { message: 'bvn must be an 11-digit BVN or NIN' })
  bvn!: string;
}
