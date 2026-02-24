import { PartialType } from '@nestjs/swagger';
import { CreateLTAAgreementDto } from './create-lta-agreement.dto';

export class UpdateLTAAgreementDto extends PartialType(CreateLTAAgreementDto) {}
