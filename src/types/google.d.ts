/**
 * The parts of Google's browser libraries that Blinked uses.
 *
 * Declared in one place because two features touch `window.google`: sign-in
 * (the ID-token flow, which proves identity and asks for no scopes) and Drive
 * import (the token flow, which asks for one narrow scope). Declaring the same
 * global in two files would conflict.
 */

interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleTokenResponse {
  access_token?: string;
  error?: string;
  error_description?: string;
}

interface GooglePickerDocument {
  id: string;
  name: string;
  mimeType: string;
  sizeBytes?: number;
}

interface GooglePickerResponse {
  action: string;
  docs?: GooglePickerDocument[];
}

interface GooglePickerBuilder {
  addView(view: unknown): GooglePickerBuilder;
  setOAuthToken(token: string): GooglePickerBuilder;
  setDeveloperKey(key: string): GooglePickerBuilder;
  /** Required with the drive.file scope, so picked files become reachable. */
  setAppId(appId: string): GooglePickerBuilder;
  setCallback(cb: (response: GooglePickerResponse) => void): GooglePickerBuilder;
  enableFeature(feature: unknown): GooglePickerBuilder;
  setTitle(title: string): GooglePickerBuilder;
  build(): { setVisible(visible: boolean): void };
}

interface GoogleDocsView {
  setIncludeFolders(include: boolean): GoogleDocsView;
  setSelectFolderEnabled(enabled: boolean): GoogleDocsView;
  setMimeTypes(mimeTypes: string): GoogleDocsView;
  setMode(mode: unknown): GoogleDocsView;
}

interface Window {
  google?: {
    accounts: {
      id: {
        initialize: (config: {
          client_id: string;
          callback: (response: GoogleCredentialResponse) => void;
          auto_select?: boolean;
        }) => void;
        renderButton: (parent: HTMLElement, options: Record<string, unknown>) => void;
        prompt: () => void;
        cancel: () => void;
      };
      oauth2: {
        initTokenClient: (config: {
          client_id: string;
          scope: string;
          callback: (response: GoogleTokenResponse) => void;
          error_callback?: (error: { type?: string; message?: string }) => void;
        }) => { requestAccessToken: (overrides?: { prompt?: string }) => void };
        revoke: (token: string, done?: () => void) => void;
      };
    };
    picker?: {
      PickerBuilder: new () => GooglePickerBuilder;
      DocsView: new (viewId?: unknown) => GoogleDocsView;
      ViewId: { DOCS_IMAGES: unknown; DOCS: unknown };
      DocsViewMode: { GRID: unknown; LIST: unknown };
      Feature: { MULTISELECT_ENABLED: unknown; NAV_HIDDEN: unknown };
      Action: { PICKED: string; CANCEL: string };
      Response: { ACTION: string; DOCUMENTS: string };
    };
  };
  gapi?: {
    load: (libraries: string, callback: () => void) => void;
  };
}
