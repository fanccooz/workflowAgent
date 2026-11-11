// @ts-nocheck
/** 回填进行中时禁止关目标弹窗，避免填写和关窗互相拆台。 */

let formFillLock = 0;

export function beginFormFill() {
  formFillLock += 1;
}

export function endFormFill() {
  formFillLock = Math.max(0, formFillLock - 1);
}

export function isFormFillActive() {
  return formFillLock > 0;
}
