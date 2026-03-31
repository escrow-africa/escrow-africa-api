import { Controller, All, Req, Res } from '@nestjs/common';
import axios from 'axios';

@Controller()
export class AppController {

  @All('auth/*')
  async authProxy(@Req() req: any, @Res() res: any) {
    const url = `https://auth-service.onrender.com/${req.url}`;

    const response = await axios({
      method: req.method,
      url,
      data: req.body,
      headers: req.headers,
    });

    return res.status(response.status).send(response.data);
  }

  @All('escrow/*')
  async escrowProxy(@Req() req: any, @Res() res: any) {
    const url = `https://escrow-service.onrender.com/${req.url}`;

    const response = await axios({
      method: req.method,
      url,
      data: req.body,
      headers: req.headers,
    });

    return res.status(response.status).send(response.data);
  }

}
