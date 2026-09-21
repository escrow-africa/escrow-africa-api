import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class ContactSupportDto {
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  subject!: string;

  @IsNotEmpty()
  @IsString()
  @MaxLength(5000)
  message!: string;
}
