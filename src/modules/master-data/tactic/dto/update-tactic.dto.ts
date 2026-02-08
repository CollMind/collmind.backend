import { PartialType } from '@nestjs/swagger';
import { CreateTacticDto } from './create-tactic.dto';

export class UpdateTacticDto extends PartialType(CreateTacticDto) {}
