import { IsEmail, IsNotEmpty } from 'class-validator';

export class RegisterDto {
  @IsNotEmpty()
  fullName!: string;

  @IsEmail()
  email!: string;

  @IsNotEmpty()
  phone!: string;

  @IsNotEmpty()
  password!: string;
}
