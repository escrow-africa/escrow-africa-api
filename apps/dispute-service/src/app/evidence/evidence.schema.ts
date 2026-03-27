import { Prop, Schema, SchemaFactory } from '@nestjs/mongoose';
import { Document } from 'mongoose';

export type EvidenceDocument = Evidence & Document;

@Schema({ timestamps: true, _id: false })
export class EvidenceMessage {
  @Prop({ required: true })
  senderId!: string;

  @Prop({ required: true })
  text!: string;

  @Prop({ default: Date.now })
  timestamp!: Date;
}

const EvidenceMessageSchema = SchemaFactory.createForClass(EvidenceMessage);

@Schema({ timestamps: true, collection: 'evidences' })
export class Evidence {
  @Prop({ required: true, unique: true, index: true })
  disputeId!: string;

  @Prop({ type: [EvidenceMessageSchema], default: [] })
  messages!: EvidenceMessage[];

  @Prop({ type: [String], default: [] })
  attachments!: string[];
}

export const EvidenceSchema = SchemaFactory.createForClass(Evidence);
