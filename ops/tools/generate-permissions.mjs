#!/usr/bin/env node
/**
 * generate-permissions.mjs
 *
 * Generator for permissions artifacts from spec annotations.
 * Reads spec/openapi.yaml (bundled spec) and extracts x-mbapp-permission
 * annotations to produce:
 *   1. spec/generated/permissions.json (endpoint -> permission mapping)
 *   2. spec/generated/permissions.ts (TypeScript constant export)
 *   3. apps/web/src/generated/permissions.ts (web convenience copy)
 *   4. apps/mobile/src/generated/permissions.ts (mobile convenience copy)
 *
 * Invoked by: npm run spec:permissions (wired into spec:bundle)
 */

import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";
import * as YAML from "yaml";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.join(__dirname, "../..");
const specFile = path.join(rootDir, "spec/openapi.yaml");
const generatedDir = path.join(rootDir, "spec/generated");
const permissionsJsonPath = path.join(generatedDir, "permissions.json");
const permissionsTsPath = path.join(generatedDir, "permissions.ts");
const webPermissionsPath = path.join(rootDir, "apps/web/src/generated/permissions.ts");
const mobilePermissionsPath = path.join(
  rootDir,
  "apps/mobile/src/generated/permissions.ts"
);

/**
 * Required endpoints that MUST have permission annotations.
 * This is a coverage guard to prevent regression on curated endpoints.
 * Add new endpoints here as they are annotated in the spec.
 */
const REQUIRED_ENDPOINTS = [
  "POST /objects/backorderRequest/{id}:ignore",
  "POST /objects/backorderRequest/{id}:convert",
  "POST /purchasing/suggest-po",
  "POST /purchasing/po:create-from-suggestion",
  "POST /purchasing/po/{id}:approve",
  "POST /purchasing/po/{id}:receive",
  "POST /purchasing/po/{id}:cancel",
  "POST /purchasing/po/{id}:close",
];

/**
 * Ensure spec/generated directory exists
 */
function ensureGeneratedDir() {
  if (!fs.existsSync(generatedDir)) {
    fs.mkdirSync(generatedDir, { recursive: true });
    console.log(`Created directory: ${generatedDir}`);
  }
}

/**
 * Ensure apps/web/src/generated and apps/mobile/src/generated exist
 */
function ensureWebMobileGeneratedDirs() {
  const webGenDir = path.join(rootDir, "apps/web/src/generated");
  const mobileGenDir = path.join(rootDir, "apps/mobile/src/generated");

  if (!fs.existsSync(webGenDir)) {
    fs.mkdirSync(webGenDir, { recursive: true });
  }
  if (!fs.existsSync(mobileGenDir)) {
    fs.mkdirSync(mobileGenDir, { recursive: true });
  }
}

/**
 * Extract permission annotations from spec.
 * Returns a stable Map<"METHOD /path", "permission:key">
 */
function extractPermissions(spec) {
  const permissions = new Map();

  if (!spec.paths) {
    console.warn("No paths found in spec");
    return permissions;
  }

  for (const [pathKey, pathItem] of Object.entries(spec.paths)) {
    if (!pathItem || typeof pathItem !== "object") {
      continue;
    }

    // Check each HTTP method (get, post, put, delete, patch, etc.)
    for (const [method, operation] of Object.entries(pathItem)) {
      if (!["get", "post", "put", "delete", "patch", "head", "options"].includes(method.toLowerCase())) {
        continue;
      }

      if (!operation || typeof operation !== "object") {
        continue;
      }

      // Extract x-mbapp-permission annotation if present
      if (operation["x-mbapp-permission"]) {
        const permKey = `${method.toUpperCase()} ${pathKey}`;
        const perm = operation["x-mbapp-permission"];
        permissions.set(permKey, perm);
      }
    }
  }

  return permissions;
}

/**
 * Convert Map to stable sorted JSON object
 */
function sortedPermissionsObject(permissionsMap) {
  const entries = Array.from(permissionsMap.entries()).sort(([a], [b]) =>
    a.localeCompare(b)
  );
  const obj = {};
  for (const [key, val] of entries) {
    obj[key] = val;
  }
  return obj;
}

/**
 * Validate that all required endpoints have permission annotations.
 * Throws an error if any required endpoint is missing.
 */
function validateRequiredCoverage(permissionsMap) {
  const missing = [];
  for (const endpoint of REQUIRED_ENDPOINTS) {
    if (!permissionsMap.has(endpoint)) {
      missing.push(endpoint);
    }
  }

  if (missing.length > 0) {
    console.error("❌ Coverage guard failed: Required endpoints missing permission annotations:");
    for (const endpoint of missing) {
      console.error(`   - ${endpoint}`);
    }
    throw new Error(
      `${missing.length} required endpoint(s) missing x-mbapp-permission annotations. ` +
      `Update spec/MBapp-Modules.yaml to add annotations for these endpoints.`
    );
  }

  console.log(`✓ Coverage guard passed: All ${REQUIRED_ENDPOINTS.length} required endpoints annotated`);
}

/**
 * Generate TypeScript constant export
 */
function generateTsExport(permissionsObj) {
  const entries = Object.entries(permissionsObj)
    .map(([key, perm]) => `  "${key}": "${perm}"`)
    .join(",\n");

  // Extract unique permission values and generate alias constants
  const uniquePermissions = [...new Set(Object.values(permissionsObj))].sort();
  
  // Generate alias constant name from permission key
  const getAliasName = (permKey) => {
    return "PERM_" + permKey.toUpperCase().replace(/[^A-Z0-9]+/g, "_");
  };

  const aliasConstants = uniquePermissions
    .map(perm => `export const ${getAliasName(perm)} = "${perm}" as const;`)
    .join("\n");

  const permissionKeysArray = uniquePermissions
    .map(perm => `  "${perm}"`)
    .join(",\n");

  return `/**
 * Auto-generated permissions mapping from spec/openapi.yaml.
 * DO NOT EDIT MANUALLY. Regenerate with: npm run spec:permissions
 *
 * Format: "METHOD /path" -> "permission:key"
 * Example: "POST /purchasing/suggest-po" -> "purchase:write"
 */

export const PERMISSIONS_BY_ENDPOINT = {
${entries}
} as const;

/**
 * Reverse mapping for convenience: permission -> endpoints
 */
export const ENDPOINTS_BY_PERMISSION = Object.entries(
  PERMISSIONS_BY_ENDPOINT
).reduce<Record<string, string[]>>((acc, [endpoint, perm]) => {
  if (!acc[perm]) {
    acc[perm] = [];
  }
  acc[perm].push(endpoint);
  return acc;
}, {});

// Export types for stricter TypeScript usage
export type PermissionKey = typeof PERMISSIONS_BY_ENDPOINT[keyof typeof PERMISSIONS_BY_ENDPOINT];
export type EndpointKey = keyof typeof PERMISSIONS_BY_ENDPOINT;

/**
 * Ergonomic permission alias constants.
 * Use these for cleaner permission checks in UI code.
 * Example: hasPerm(policy, PERM_OBJECTS_WRITE)
 */
${aliasConstants}

/**
 * Array of all unique permission keys (sorted).
 */
export const PERMISSION_KEYS = [
${permissionKeysArray}
] as const;
`;
}

/**
 * Main generator
 */
async function generatePermissions() {
  try {
    // 1. Ensure directories exist
    ensureGeneratedDir();
    ensureWebMobileGeneratedDirs();

    // 2. Read and parse bundled spec
    if (!fs.existsSync(specFile)) {
      throw new Error(`Spec file not found: ${specFile}`);
    }

    const specContent = fs.readFileSync(specFile, "utf-8");
    const spec = YAML.parse(specContent);

    if (!spec || typeof spec !== "object") {
      throw new Error("Failed to parse spec as YAML");
    }

    // 3. Extract permissions from annotations
    const permissionsMap = extractPermissions(spec);

    if (permissionsMap.size === 0) {
      console.warn("No x-mbapp-permission annotations found in spec");
    }

    // 4. Validate required coverage (guard against regression)
    validateRequiredCoverage(permissionsMap);

    // 5. Generate artifacts
    const permissionsObj = sortedPermissionsObject(permissionsMap);
    const tsExport = generateTsExport(permissionsObj);

    // 6. Write JSON artifact
    fs.writeFileSync(
      permissionsJsonPath,
      JSON.stringify(permissionsObj, null, 2) + "\n"
    );
    console.log(`✓ Generated: ${permissionsJsonPath}`);

    // 7. Write TS artifact to spec/generated
    fs.writeFileSync(permissionsTsPath, tsExport);
    console.log(`✓ Generated: ${permissionsTsPath}`);

    // 8. Copy TS artifact to web
    fs.writeFileSync(webPermissionsPath, tsExport);
    console.log(`✓ Generated: ${webPermissionsPath}`);

    // 9. Copy TS artifact to mobile
    fs.writeFileSync(mobilePermissionsPath, tsExport);
    console.log(`✓ Generated: ${mobilePermissionsPath}`);

    // 10. Summary
    console.log(`\n✅ Permissions generation complete.`);
    console.log(`   Endpoints extracted: ${permissionsMap.size}`);
    console.log(`   Unique permissions: ${new Set(permissionsMap.values()).size}`);

    process.exit(0);
  } catch (error) {
    console.error("Error generating permissions:", error.message);
    process.exit(1);
  }
}

// Run generator
generatePermissions();
