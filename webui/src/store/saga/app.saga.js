import { delay } from 'redux-saga';
import { call, put, select, take, takeEvery, takeLatest } from 'redux-saga/effects';

import { getErrorMessage as getApiErrorMessage, isDeadServerError, SERVER_NOT_REACHABLE_ERROR_TYPE } from 'src/api';
import { pageRequestIndicator } from 'src/misc/pageRequestIndicator';
import {
  APP_DID_MOUNT,
  APP_DATA_REQUEST,
  APP_DATA_REQUEST_SUCCESS,
  APP_DATA_REQUEST_ERROR,
  APP_LOGIN_REQUEST,
  APP_LOGIN_REQUEST_SUCCESS,
  APP_LOGIN_REQUEST_ERROR,
  APP_LOGOUT_REQUEST,
  APP_LOGOUT_REQUEST_SUCCESS,
  APP_LOGOUT_REQUEST_ERROR,
  APP_DENY_ANONYMOUS_REQUEST,
  APP_DENY_ANONYMOUS_REQUEST_SUCCESS,
  APP_DENY_ANONYMOUS_REQUEST_ERROR,
  APP_ALLOW_ANONYMOUS_REQUEST,
  APP_ALLOW_ANONYMOUS_REQUEST_SUCCESS,
  APP_ALLOW_ANONYMOUS_REQUEST_ERROR,
  APP_SERVER_CONSOLE_EVAL_STRING_REQUEST,
  APP_SERVER_CONSOLE_EVAL_STRING_REQUEST_SUCCESS,
  APP_SERVER_CONSOLE_EVAL_STRING_REQUEST_ERROR,
  APP_CREATE_MESSAGE,
  APP_SET_MESSAGE_DONE,
} from 'src/store/actionTypes';
import { baseSaga, getRequestSaga } from 'src/store/commonRequest';
import { getClusterSelf, login, logout, denyAnonymous, allowAnonymous, evalString }
  from 'src/store/request/app.requests';

function* appDataRequestSaga() {
  yield takeLatest(APP_DID_MOUNT, function* load(action) {
    const { payload: requestPayload = {} } = action;
    const indicator = pageRequestIndicator.run();

    yield put({ type: APP_DATA_REQUEST, payload: requestPayload });

    let response;
    try {
      const clusterSelfResponse = yield call(getClusterSelf);

      response = {
        ...clusterSelfResponse,
        isAnonymousAllowed: true,
        authenticated: null,
      };
    }
    catch (error) {
      yield put({ type: APP_DATA_REQUEST_ERROR, error, requestPayload, __errorMessage: false });
      indicator.error();
      return undefined;
    }

    yield put({ type: APP_DATA_REQUEST_SUCCESS, payload: response, requestPayload });
    indicator.success();
  });
};

const denyAnonymousRequestSaga = getRequestSaga(
  APP_DENY_ANONYMOUS_REQUEST,
  APP_DENY_ANONYMOUS_REQUEST_SUCCESS,
  APP_DENY_ANONYMOUS_REQUEST_ERROR,
  denyAnonymous,
);

const allowAnonymousRequestSaga = getRequestSaga(
  APP_ALLOW_ANONYMOUS_REQUEST,
  APP_ALLOW_ANONYMOUS_REQUEST_SUCCESS,
  APP_ALLOW_ANONYMOUS_REQUEST_ERROR,
  allowAnonymous,
);

const evalStringRequestSaga = getRequestSaga(
  APP_SERVER_CONSOLE_EVAL_STRING_REQUEST,
  APP_SERVER_CONSOLE_EVAL_STRING_REQUEST_SUCCESS,
  APP_SERVER_CONSOLE_EVAL_STRING_REQUEST_ERROR,
  evalString,
);

const loginRequestSaga = getRequestSaga(
  APP_LOGIN_REQUEST,
  APP_LOGIN_REQUEST_SUCCESS,
  APP_LOGIN_REQUEST_ERROR,
  login,
);

const logoutRequestSaga = getRequestSaga(
  APP_LOGOUT_REQUEST,
  APP_LOGOUT_REQUEST_SUCCESS,
  APP_LOGOUT_REQUEST_ERROR,
  logout,
);

function* getActiveDeadServerMessage() {
  const messages = yield select(state => state.app.messages);
  return messages.find(
    message => message.type === SERVER_NOT_REACHABLE_ERROR_TYPE && !message.done
  );
}

function* appMessageSaga() {
  while (true) {
    const action = yield take('*');

    if (action.error && isDeadServerError(action.error)) {
      const activeDeadServerMessage = yield call(getActiveDeadServerMessage);
      if ( ! activeDeadServerMessage) {
        const message = {
          content: { type: 'danger', text: 'It seems like server is not reachable' },
          type: SERVER_NOT_REACHABLE_ERROR_TYPE,
        };
        yield put({ type: APP_CREATE_MESSAGE, payload: message });
      }
    }
    else {
      if (action.requestPayload) {
        const activeDeadServerMessage = yield call(getActiveDeadServerMessage);
        if (activeDeadServerMessage) {
          yield put({ type: APP_SET_MESSAGE_DONE, payload: activeDeadServerMessage });
        }
      }

      if (action.error && action.__errorMessage) {
        const message = {
          content: { type: 'danger', text: getApiErrorMessage(action.error) },
        };
        yield put({ type: APP_CREATE_MESSAGE, payload: message });
      }
    }

    if (action.__successMessage) {
      const message = {
        content: { type: 'success', text: action.__successMessage },
      };
      yield put({ type: APP_CREATE_MESSAGE, payload: message });
    }
  }
}

function* doneMessage() {
  yield takeEvery(APP_CREATE_MESSAGE, function* (action) {
    if (action.payload.content.type === 'success') {
      yield delay(3000);
      yield put({ type: APP_SET_MESSAGE_DONE, payload: { content: action.payload.content } });
    }
  });
}

export const saga = baseSaga(
  appDataRequestSaga,
  denyAnonymousRequestSaga,
  allowAnonymousRequestSaga,
  evalStringRequestSaga,
  loginRequestSaga,
  logoutRequestSaga,
  appMessageSaga,
  doneMessage,
);