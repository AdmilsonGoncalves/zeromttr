export interface AnnotationRequest {
  time?: number;
  text: string;
  tags?: string[];
  pull_request_url?: string;
}

export interface AnnotationReceipt {
  id: number;
  message: string;
}

export interface AnnotationPort {
  createAnnotation(req: AnnotationRequest): Promise<AnnotationReceipt>;
}
