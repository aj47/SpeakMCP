declare namespace NodeJS {
  interface ProcessEnv {
    APP_ID: string
    APP_VERSION: string
    PRODUCT_NAME: string
    IS_MAC: boolean
  }
}
