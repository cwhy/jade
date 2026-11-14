// SPDX-License-Identifier: MPL-2.0
import { STORAGE_CODEC, upgradeStorage } from "@cwhy/jade-core/storage";
export function upgradeRecord(record) {
  if (record?.state?.storageCodec === STORAGE_CODEC) return record;
  return { ...record, state: upgradeStorage(record?.state) };
}
