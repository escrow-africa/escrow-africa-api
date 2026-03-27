import { IsNotEmpty, IsString, IsUUID } from 'class-validator';

export class CreateDisputeDto {
  @IsUUID()
  @IsNotEmpty()
  escrowId!: string;

  @IsString()
  @IsNotEmpty()
  reason!: string;
}
