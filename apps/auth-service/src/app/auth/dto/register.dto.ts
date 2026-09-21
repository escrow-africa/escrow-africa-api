import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

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
}
