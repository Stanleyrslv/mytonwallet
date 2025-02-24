import { BottomSheet } from 'native-bottom-sheet';
import React, {
  memo, useEffect, useMemo, useRef, useState,
} from '../lib/teact/teact';
import { getActions, withGlobal } from '../global';

import type { AutolockValueType, Theme } from '../global/types';

import { AUTOLOCK_OPTIONS_LIST, DEBUG, IS_CAPACITOR } from '../config';
import { selectIsHardwareAccount } from '../global/selectors';
import buildClassName from '../util/buildClassName';
import { vibrateOnSuccess } from '../util/capacitor';
import { createSignal } from '../util/signals';
import { IS_DELEGATED_BOTTOM_SHEET, IS_DELEGATING_BOTTOM_SHEET } from '../util/windowEnvironment';
import { callApi } from '../api';

import useAppTheme from '../hooks/useAppTheme';
import useBackgroundMode, { isBackgroundModeActive } from '../hooks/useBackgroundMode';
import useEffectOnce from '../hooks/useEffectOnce';
import useFlag from '../hooks/useFlag';
import useLang from '../hooks/useLang';
import useLastCallback from '../hooks/useLastCallback';
import useShowTransition from '../hooks/useShowTransition';
import useThrottledCallback from '../hooks/useThrottledCallback';

import Button from './ui/Button';
import Image from './ui/Image';
import { getInAppBrowser } from './ui/InAppBrowser';
import PasswordForm from './ui/PasswordForm';
import Transition from './ui/Transition';

import styles from './AppLocked.module.scss';

import logoDarkPath from '../assets/logoDark.svg';
import logoLightPath from '../assets/logoLight.svg';

const WINDOW_EVENTS_LATENCY = 5000;
const INTERVAL_CHECK_PERIOD = 5000;
const PINPAD_RESET_DELAY = 300;
const ACTIVATION_EVENT_NAMES = [
  'focus', // For Web
  'mousemove', // For Web
  'touch', // For Capacitor
  'wheel',
  'keydown',
];
// `capture: true` is necessary because otherwise a `stopPropagation` call inside the main UI will prevent the event
// from getting to the listeners inside `AppLocked`.
const ACTIVATION_EVENT_OPTIONS = { capture: true };

interface StateProps {
  isNonNativeBiometricAuthEnabled: boolean;
  autolockValue?: AutolockValueType;
  theme: Theme;
  isHardwareAccount?: boolean;
}

const enum SLIDES {
  button,
  passwordForm,
}

const [getActivitySignal, setActivitySignal] = createSignal(Date.now());

export function reportAppLockActivityEvent() {
  setActivitySignal(Date.now());
}

function AppLocked({
  isNonNativeBiometricAuthEnabled, autolockValue = 'never', theme, isHardwareAccount,
}: StateProps): TeactJsx {
  const { setIsPinAccepted, clearIsPinAccepted, submitAppLockActivityEvent } = getActions();
  const lang = useLang();

  const appTheme = useAppTheme(theme);
  const logoPath = appTheme === 'light' ? logoLightPath : logoDarkPath;

  const [isLocked, lock, unlock] = useFlag(autolockValue !== 'never' && !isHardwareAccount);
  const [shouldRenderUi, showUi, hideUi] = useFlag(isLocked);
  const lastActivityTime = useRef(Date.now());
  const [slideForBiometricAuth, setSlideForBiometricAuth] = useState(
    isBackgroundModeActive() ? SLIDES.button : SLIDES.passwordForm,
  );
  const [passwordError, setPasswordError] = useState('');

  const afterUnlockCallback = useLastCallback(() => {
    hideUi();
    setSlideForBiometricAuth(SLIDES.button);
    getInAppBrowser()?.show();
    clearIsPinAccepted();
    if (IS_DELEGATING_BOTTOM_SHEET) void BottomSheet.show();
  });

  const autolockPeriod = useMemo(
    () => AUTOLOCK_OPTIONS_LIST.find((option) => option.value === autolockValue)!.period, [autolockValue],
  );

  const { transitionClassNames } = useShowTransition(isLocked, afterUnlockCallback, true, 'slow');

  const handleLock = useLastCallback(() => {
    if (autolockValue !== 'never' && !isHardwareAccount) {
      lock();
      showUi();
      if (IS_DELEGATING_BOTTOM_SHEET) void BottomSheet.hide();
      getInAppBrowser()?.hide();
    }
    setSlideForBiometricAuth(SLIDES.button);
  });

  if (DEBUG) (window as any).lock = handleLock;

  const handleChangeSlideForBiometricAuth = useLastCallback(() => {
    setSlideForBiometricAuth(SLIDES.passwordForm);
  });

  const handleSubmitPassword = useLastCallback(async (password: string) => {
    const result = await callApi('verifyPassword', password);

    if (!result) {
      setPasswordError('Wrong password, please try again.');
      return;
    }

    if (IS_CAPACITOR) {
      setIsPinAccepted();
      await vibrateOnSuccess(true);
    }
    unlock();
  });

  const handlePasswordChange = useLastCallback(() => setPasswordError(''));

  const handleActivity = useLastCallback(() => {
    if (IS_DELEGATED_BOTTOM_SHEET) {
      submitAppLockActivityEvent();
      return;
    }
    lastActivityTime.current = Date.now();
  });

  const handleActivityThrottled = useThrottledCallback(handleActivity, [handleActivity], WINDOW_EVENTS_LATENCY);

  useEffectOnce(() => {
    for (const eventName of ACTIVATION_EVENT_NAMES) {
      window.addEventListener(eventName, handleActivityThrottled, ACTIVATION_EVENT_OPTIONS);
    }

    return () => {
      for (const eventName of ACTIVATION_EVENT_NAMES) {
        window.removeEventListener(eventName, handleActivityThrottled, ACTIVATION_EVENT_OPTIONS);
      }
    };
  });

  useEffectOnce(() => {
    if (IS_DELEGATED_BOTTOM_SHEET) return undefined;

    return getActivitySignal.subscribe(handleActivityThrottled);
  });

  useEffect(() => {
    if (IS_DELEGATED_BOTTOM_SHEET) return undefined;

    const interval = setInterval(() => {
      if (!isLocked && Date.now() - lastActivityTime.current > autolockPeriod) {
        handleLock();
      }
    }, INTERVAL_CHECK_PERIOD);
    return () => clearInterval(interval);
  }, [isLocked, autolockPeriod, handleLock]);

  useBackgroundMode(undefined, handleChangeSlideForBiometricAuth);

  function renderLogo() {
    return (
      <div className={styles.logo}>
        <Image className={styles.logo} imageClassName={styles.logo} url={logoPath} alt="Logo" />
      </div>
    );
  }

  function renderTransitionContent(isActive: boolean) {
    return (
      <div
        className={buildClassName(styles.appLocked, !IS_CAPACITOR && styles.appLockedFixed)}
      >
        {
          isNonNativeBiometricAuthEnabled && slideForBiometricAuth === SLIDES.button ? (
            <>
              {renderLogo()}
              <span className={styles.title}>{lang('MyTonWallet')}</span>
              <Button
                isPrimary
                className={!isActive ? styles.unlockButtonHidden : undefined}
                onClick={handleChangeSlideForBiometricAuth}
              >
                {lang('Unlock')}
              </Button>
            </>
          ) : (
            <PasswordForm
              isActive
              noAnimatedIcon
              forceBiometricsInMain
              error={passwordError}
              resetStateDelayMs={PINPAD_RESET_DELAY}
              operationType="unlock"
              containerClassName={styles.passwordFormContent}
              inputWrapperClassName={styles.passwordInputWrapper}
              submitLabel={lang('Unlock')}
              onSubmit={handleSubmitPassword}
              onUpdate={handlePasswordChange}
            >
              {renderLogo()}
              <span className={styles.title}>{lang('MyTonWallet')}</span>
            </PasswordForm>
          )
        }
      </div>
    );
  }

  const transitionKey = Number(slideForBiometricAuth === SLIDES.passwordForm) + Number(shouldRenderUi) * 2;

  if (IS_DELEGATED_BOTTOM_SHEET) return undefined;

  return (
    <Transition
      name="semiFade"
      onContainerClick={isNonNativeBiometricAuthEnabled ? handleChangeSlideForBiometricAuth : undefined}
      activeKey={transitionKey}
      className={buildClassName(transitionClassNames, styles.appLockedWrapper)}
      shouldCleanup
    >
      {shouldRenderUi ? renderTransitionContent : undefined}
    </Transition>
  );
}

export default memo(withGlobal((global): StateProps => {
  const { authConfig, autolockValue } = global.settings;

  const isHardwareAccount = selectIsHardwareAccount(global);

  const isBiometricAuthEnabled = !!authConfig && authConfig.kind !== 'password';
  const isNativeBiometricAuthEnabled = !!authConfig && authConfig.kind === 'native-biometrics';
  const isNonNativeBiometricAuthEnabled = isBiometricAuthEnabled && !isNativeBiometricAuthEnabled;

  return {
    isNonNativeBiometricAuthEnabled, autolockValue, theme: global.settings.theme, isHardwareAccount,
  };
})(AppLocked));
