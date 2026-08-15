import {
  ConflictException,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as bcrypt from 'bcryptjs';
import { PrismaService } from '../prisma/prisma.service';
import { LoginAgentDto } from './dto/login-agent.dto';
import { RegisterAgentDto } from './dto/register-agent.dto';

@Injectable()
export class AgentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly jwtService: JwtService,
  ) {}

  private generateReferralCode(): string {
    return `AGT-${Math.random().toString(36).slice(2, 8).toUpperCase()}`;
  }

  async register(registerAgentDto: RegisterAgentDto) {
    const existingAgent = await this.prisma.agent.findUnique({
      where: { email: registerAgentDto.email },
    });

    if (existingAgent) {
      throw new ConflictException('An agent with this email already exists');
    }

    let referralCode = this.generateReferralCode();
    while (await this.prisma.agent.findUnique({ where: { referralCode } })) {
      referralCode = this.generateReferralCode();
    }

    const hashedPassword = bcrypt.hashSync(registerAgentDto.password, 10);
    const agent = await this.prisma.agent.create({
      data: {
        fullName: registerAgentDto.fullName,
        email: registerAgentDto.email,
        phone: registerAgentDto.phone,
        password: hashedPassword,
        referralCode,
      },
    });

    return {
      message: 'Agent registration successful',
      agentId: agent.id,
      referralCode: agent.referralCode,
    };
  }

  async login(loginAgentDto: LoginAgentDto) {
    const agent = await this.prisma.agent.findUnique({
      where: { email: loginAgentDto.email },
    });

    if (!agent) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const isPasswordValid = await bcrypt.compare(
      loginAgentDto.password,
      agent.password,
    );

    if (!isPasswordValid) {
      throw new UnauthorizedException('Invalid credentials');
    }

    const accessToken = this.jwtService.sign(
      { sub: agent.id, email: agent.email, role: 'AGENT' },
      { expiresIn: '1d' },
    );

    const { password: _, ...safeAgent } = agent;

    return {
      agent: safeAgent,
      accessToken,
    };
  }
}
