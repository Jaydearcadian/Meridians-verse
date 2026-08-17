import {
  Entity,
  Column,
  PrimaryGeneratedColumn,
  CreateDateColumn,
  UpdateDateColumn,
  Index,
} from 'typeorm';

@Entity('webhooks')
@Index(['address', 'contract'])
@Index(['isActive'])
export class Webhook {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ type: 'varchar', length: 255 })
  url: string;

  @Column({ type: 'varchar', length: 100, nullable: true })
  contract: string | null;

  @Column({ type: 'varchar', length: 100, nullable: true })
  action: string | null;

  @Column({ type: 'varchar', length: 255, nullable: true })
  address: string | null;

  @Column({ type: 'varchar', length: 128 })
  secret: string;

  @Column({ type: 'boolean', default: true })
  isActive: boolean;

  @Column({ type: 'int', default: 0 })
  failureCount: number;

  @Column({ type: 'timestamp', nullable: true })
  lastTriggeredAt: Date | null;

  @CreateDateColumn()
  createdAt: Date;

  @UpdateDateColumn()
  updatedAt: Date;
}
