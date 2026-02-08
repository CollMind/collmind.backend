import { PartialType } from '@nestjs/swagger';
import { CreateCplDto } from './create-cpl.dto';

export class UpdateCplDto extends PartialType(CreateCplDto) {}
