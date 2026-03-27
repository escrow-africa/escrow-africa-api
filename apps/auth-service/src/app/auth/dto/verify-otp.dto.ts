import { IsNotEmpty } from 'class-validator';

export class VerifyOtpDto {
  @IsNotEmpty()
  email!: string;

  @IsNotEmpty()
  otp!: number;
}
