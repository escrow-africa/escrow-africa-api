import { IsNotEmpty, IsString } from 'class-validator';

export class SubmitKycDto {
  @IsNotEmpty()
  @IsString()
  documentType!: string;
}
