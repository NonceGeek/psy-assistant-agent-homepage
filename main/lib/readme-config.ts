import "server-only";
import { readFileSync } from "node:fs";
import { join } from "node:path";

export type AppConfig = {
  homepageName: string;
  fullName: string;
  twitterUrl: string;
  twitterNicename: string;
  descriptionMarkdown: string;
  agentAddress: string;
  freeTierDescription: string;
  freeTierLink: string;
  agentTags: string[];
  premiumTierDescription: string;
  chatbotDescription: string;
  chatbotIntroMessage: string;
  chatApiUrl: string;
};

const REQUIRED_KEYS: Array<keyof AppConfig> = [
  "homepageName",
  "fullName",
  "twitterUrl",
  "twitterNicename",
  "descriptionMarkdown",
  "agentAddress",
  "freeTierDescription",
  "freeTierLink",
  "agentTags",
  "premiumTierDescription",
  "chatbotDescription",
  "chatbotIntroMessage",
  "chatApiUrl",
];

function parseValue(rawValue: string): unknown {
  const trimmed = rawValue.trim();
  try {
    return JSON.parse(trimmed);
  } catch {
    return trimmed;
  }
}

function parseConfigFromReadme(readme: string): Partial<AppConfig> {
  const parsed: Partial<AppConfig> = {};
  const lines = readme.split("\n");
  let currentKey: string | null = null;

  for (const line of lines) {
    const keyMatch = line.match(/^\* \*\*([A-Za-z0-9_]+)\*\*:?\s*$/);
    if (keyMatch) {
      currentKey = keyMatch[1];
      continue;
    }

    const valueMatch = line.match(/^\s*\* \*\*value:\*\* `(.*)`\s*$/);
    if (!valueMatch || !currentKey) continue;

    const key = currentKey as keyof AppConfig;
    if (!REQUIRED_KEYS.includes(key)) continue;

    parsed[key] = parseValue(valueMatch[1]) as never;
  }

  return parsed;
}

export function getReadmeConfig(): AppConfig {
  const readmePath = join(process.cwd(), "README.md");
  const readme = readFileSync(readmePath, "utf-8");
  const parsed = parseConfigFromReadme(readme);

  for (const key of REQUIRED_KEYS) {
    if (!(key in parsed)) {
      throw new Error(`Missing config key "${key}" in README.md configuration section`);
    }
  }

  return parsed as AppConfig;
}
