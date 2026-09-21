import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class WaitlistDto {
  @IsNotEmpty()
  @IsString()
  firstName!: string;

  @IsNotEmpty()
  @IsString()
  lastName!: string;

  @IsOptional()
  @IsString()
  phone?: string;

  @IsEmail()
  email!: string;
}
