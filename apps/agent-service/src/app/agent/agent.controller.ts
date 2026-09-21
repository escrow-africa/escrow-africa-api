import { Body, Controller, HttpCode, Post } from '@nestjs/common';
import { AgentService } from './agent.service';
import { LoginAgentDto } from './dto/login-agent.dto';
import { RegisterAgentDto } from './dto/register-agent.dto';

@Controller('agents')
export class AgentController {
  constructor(private readonly agentService: AgentService) {}

  @Post('register')
  register(@Body() registerAgentDto: RegisterAgentDto) {
    return this.agentService.register(registerAgentDto);
  }

  @Post('login')
  @HttpCode(200)
  login(@Body() loginAgentDto: LoginAgentDto) {
    return this.agentService.login(loginAgentDto);
  }
}
