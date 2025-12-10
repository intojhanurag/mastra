export type IndexType = 'ivfflat' | 'hnsw' | 'flat';

// Vector storage types supported by pgvector
export type VectorType = 'vector' | 'halfvec' | 'bit' | 'sparsevec';

// Distance metrics for different vector types
export type VectorMetric = 'cosine' | 'euclidean' | 'dotproduct';
export type BitMetric = 'hamming' | 'jaccard';
export type SparseVecMetric = 'cosine' | 'euclidean' | 'dotproduct';

// Combined metric type
export type DistanceMetric = VectorMetric | BitMetric;

interface IVFConfig {
  lists?: number;
}

interface HNSWConfig {
  m?: number; // Max number of connections (default: 16)
  efConstruction?: number; // Build-time complexity (default: 64)
}

export interface IndexConfig {
  type?: IndexType;
  ivf?: IVFConfig;
  hnsw?: HNSWConfig;
  vectorType?: VectorType; // Storage type: vector (full), halfvec (half), bit (binary), sparsevec (sparse)
}
