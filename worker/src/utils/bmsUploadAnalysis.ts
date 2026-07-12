import { analyzeBmsBuffer, BmsAnalysis, BmsAnalysisWarning, BmsMetadata, parseBmsMetadata } from "./bms";
import { md5HexFromBuffer } from "./hash";

export type UploadAnalysisWarning = {
  code: string;
  message: string;
  detail?: string;
};

export type UploadBmsAnalysis = {
  md5: string;
  metadata: BmsMetadata;
  metadataWarning: UploadAnalysisWarning | null;
  analysis: BmsAnalysis | null;
  analysisWarnings: UploadAnalysisWarning[];
  analysisFailed: boolean;
};

function errorDetail(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function toWarning(warning: BmsAnalysisWarning): UploadAnalysisWarning {
  return {
    code: warning.code,
    message: warning.message,
    detail: warning.detail
  };
}

export function analyzeUploadedBmsBytes(buffer: ArrayBuffer): UploadBmsAnalysis {
  let metadata: BmsMetadata = {};
  let metadataWarning: UploadAnalysisWarning | null = null;
  let analysis: BmsAnalysis | null = null;
  const analysisWarnings: UploadAnalysisWarning[] = [];
  let analysisFailed = false;

  try {
    metadata = parseBmsMetadata(buffer);
  } catch (error) {
    metadataWarning = {
      code: "BMS_METADATA_PARSE_FAILED",
      message: "譜面情報の自動読み取りに失敗したため、フォーム入力値を使用しました。",
      detail: errorDetail(error)
    };
  }

  try {
    analysis = analyzeBmsBuffer(buffer);
    analysisWarnings.push(...analysis.warnings.map(toWarning));
  } catch (error) {
    analysisFailed = true;
    analysisWarnings.push({
      code: "BMS_ANALYSIS_FAILED",
      message: "譜面の小節解析に失敗したため、進捗グラフ情報なしで投稿します。",
      detail: errorDetail(error)
    });
  }

  return {
    md5: md5HexFromBuffer(buffer),
    metadata,
    metadataWarning,
    analysis,
    analysisWarnings,
    analysisFailed
  };
}
