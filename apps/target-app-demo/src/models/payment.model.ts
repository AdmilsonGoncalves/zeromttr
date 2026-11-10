import { z } from 'zod';

export const PaymentStatusEnum = z.enum(['completed', 'failed', 'pending']);
export type PaymentStatus = z.infer<typeof PaymentStatusEnum>;

export const CreatePaymentSchema = z.object({
  amount: z.number().positive(),
  currency: z.string().optional().default('BRL'),
  payerCpf: z.string().regex(/^(\d{11}|\d{3}\.\d{3}\.\d{3}-\d{2})$/, 'Invalid CPF format'),
  merchantCnpj: z
    .string()
    .regex(/^(\d{14}|\d{2}\.\d{3}\.\d{3}\/\d{4}-\d{2})$/, 'Invalid CNPJ format'),
  pixKey: z.string().min(3),
  description: z.string().optional().default('PIX Payment Transaction'),
  authHeader: z.string().optional()
});

export type CreatePaymentInput = z.infer<typeof CreatePaymentSchema>;

export interface Payment {
  id: string;
  txId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  payerCpf: string;
  merchantCnpj: string;
  pixKey: string;
  description: string;
  createdAt: string;
  updatedAt: string;
}
