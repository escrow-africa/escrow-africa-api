import { Controller, All, Req, Res } from '@nestjs/common';
import axios from 'axios';

@Controller()
export class AppController {
  @All('auth/*path')
  async authProxy(@Req() req: any, @Res() res: any) {
    const url = `${process.env.AUTH_API_URL}${req.url}`;

    const response = await axios({
      method: req.method,
      url,
      data: req.body,
      headers: req.headers,
    });

    return res.status(response.status).send(response.data);
  }

  @All('dispute/*path')
  async escrowProxy(@Req() req: any, @Res() res: any) {
    const url = `${process.env.DISPUTE_API_URL}${req.url}`;

    const response = await axios({
      method: req.method,
      url,
      data: req.body,
      headers: req.headers,
    });

    return res.status(response.status).send(response.data);
  }
}
