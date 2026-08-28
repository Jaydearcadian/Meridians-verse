import {
  Column,
  Entity,
  PrimaryGeneratedColumn,
  Index,
} from 'typeorm';

@Entity()
@Index(['userId'])
export class RefreshToken {
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @Column({ unique: true })
  jti: string;

  @Column()
  userId: number;

  @Column()
  tokenHash: string;

  @Column({ type: 'timestamp' })
  expiresAt: Date;

  @Column({ type: 'timestamp', nullable: true })
  revokedAt: Date | null;

  @Column({ nullable: true })
  userAgent: string | null;

  // Session management / device tracking (issue #665).
  @Column({ nullable: true })
  deviceName: string | null;

  @Column({ nullable: true })
  ipAddress: string | null;

  @Column({ nullable: true })
  location: string | null;

  @Column({ type: 'timestamp', nullable: true })
  lastUsedAt: Date | null;

  // Envelope encryption (issue #631): the DEK id used to encrypt this row's
  // refresh-token plaintext (reuses the owner user's DEK when available) and
  // the resulting ciphertext envelope.
  @Column({ type: 'uuid', nullable: true })
  dataEncryptionKeyId: string | null;

  @Column({ type: 'text', nullable: true })
  encryptedData: string | null;
}
