import { IS_EXTENSION } from '../config';

export const IS_EXTENSION_PAGE_SCRIPT = IS_EXTENSION
  // eslint-disable-next-line no-restricted-globals
  && !['chrome-extension:', 'moz-extension:'].includes(self.location.protocol);
