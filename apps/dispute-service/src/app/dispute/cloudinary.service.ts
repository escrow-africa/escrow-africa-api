import { Injectable, Logger } from '@nestjs/common';
import { v2 as cloudinary } from 'cloudinary';

@Injectable()
export class CloudinaryService {
  private readonly logger = new Logger(CloudinaryService.name);

  constructor() {
    cloudinary.config({
      cloud_name: process.env.CLOUDINARY_CLOUD_NAME,
      api_key: process.env.CLOUDINARY_API_KEY,
      api_secret: process.env.CLOUDINARY_API_SECRET,
    });
  }

  async uploadBuffer(
    buffer: Buffer,
    options: { folder?: string; resource_type?: 'auto' | 'image' | 'video' | 'raw'; public_id?: string } = {},
  ): Promise<string> {
    return new Promise((resolve, reject) => {
      const uploadStream = cloudinary.uploader.upload_stream(
        {
          folder: options.folder || 'dispute-proofs',
          resource_type: options.resource_type || 'auto',
          public_id: options.public_id,
        },
        (error, result) => {
          if (error) {
            this.logger.error('Cloudinary upload failed', error);
            return reject(error);
          }

          resolve(result!.secure_url);
        },
      );

      uploadStream.end(buffer);
    });
  }
}
