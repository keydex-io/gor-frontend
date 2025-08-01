import {
  ApiV3PoolInfoStandardItem,
  ApiV3PoolInfoStandardItemCpmm,
  ApiV3PoolInfoConcentratedItem,
  CreateCpmmPoolAddress,
  ApiV3Token,
  FormatFarmInfoOutV6,
  toToken,
  TokenAmount,
  Percent,
  getCpmmPdaAmmConfigId,
  CpmmConfigInfoLayout,
  ApiCpmmConfigInfo,
  CpmmLockExtInfo
} from '@raydium-io/raydium-sdk-v2'
import { PublicKey } from '@solana/web3.js'
import createStore from './createStore'
import { useAppStore } from './useAppStore'
import { toastSubject } from '@/hooks/toast/useGlobalToast'
import { txStatusSubject } from '@/hooks/toast/useTxStatus'
import { getDefaultToastData, transformProcessData, handleMultiTxToast } from '@/hooks/toast/multiToastUtil'
import { TxCallbackProps, TxCallbackPropsGeneric } from '@/types/tx'
import { formatLocaleStr } from '@/utils/numberish/formatter'

import { getTxMeta } from './configs/liquidity'
import { getMintSymbol } from '@/utils/token'
import getEphemeralSigners from '@/utils/tx/getEphemeralSigners'
import { getPoolName } from '@/features/Pools/util'
import { handleMultiTxRetry } from '@/hooks/toast/retryTx'
import BN from 'bn.js'
import Decimal from 'decimal.js'
import { getComputeBudgetConfig } from '@/utils/tx/computeBudget'
import { useTokenAccountStore } from './useTokenAccountStore'

export const LIQUIDITY_SLIPPAGE_KEY = '_r_lqd_slippage_'

interface LiquidityStore {
  newCreatedPool?: CreateCpmmPoolAddress
  createPoolFee: string
  slippage: number
  cpmmFeeConfigs: Record<string, ApiCpmmConfigInfo>

  addCpmmLiquidityAct: (
    params: {
      poolInfo: ApiV3PoolInfoStandardItemCpmm
      inputAmount: string
      anotherAmount: string
      liquidity: string
      baseIn: boolean
    } & TxCallbackProps
  ) => Promise<string>

  removeCpmmLiquidityAct: (
    params: {
      poolInfo: ApiV3PoolInfoStandardItemCpmm
      lpAmount: string
      amountA: string
      amountB: string
      config?: {
        bypassAssociatedCheck?: boolean
      }
    } & TxCallbackProps
  ) => Promise<string>

  createPoolAct: (
    params: {
      pool: {
        mintA: ApiV3Token
        mintB: ApiV3Token
        feeConfig: ApiCpmmConfigInfo
      }
      baseAmount: string
      quoteAmount: string
      startTime?: Date
    } & TxCallbackProps
  ) => Promise<string>

  lockCpmmLpAct: (
    params: {
      poolInfo: ApiV3PoolInfoStandardItemCpmm
      lpAmount: BN
    } & TxCallbackPropsGeneric<CpmmLockExtInfo>
  ) => Promise<string>

  harvestLockCpmmLpAct: (
    params: {
      poolInfo: ApiV3PoolInfoStandardItemCpmm
      nftMint: PublicKey
      lpFeeAmount: BN
    } & TxCallbackProps
  ) => Promise<string>

  computePairAmount: (params: {
    pool: ApiV3PoolInfoStandardItem | ApiV3PoolInfoStandardItemCpmm
    baseReserve: BN
    quoteReserve: BN
    amount: string
    baseIn: boolean
  }) => Promise<{
    output: string
    maxOutput: string
    minOutput: string
    liquidity: BN
  }>

  getCreatePoolFeeAct: () => Promise<void>
  fetchCpmmConfigsAct: () => void

  resetComputeStateAct: () => void
}

const initLiquiditySate = {
  createPoolFee: '',
  slippage: 0.025,
  cpmmFeeConfigs: {}
}

export const useLiquidityStore = createStore<LiquidityStore>(
  (set, get) => ({
    ...initLiquiditySate,

    addCpmmLiquidityAct: async ({ onSent, onError, onFinally, ...params }) => {
      const { raydium, txVersion, getEpochInfo } = useAppStore.getState()
      if (!raydium) return ''
      const baseIn = params.baseIn
      const computeBudgetConfig = await getComputeBudgetConfig()

      const percentSlippage = new Percent((get().slippage * 10000).toFixed(0), 10000)
      const rpcData = await raydium.cpmm.getRpcPoolInfo(params.poolInfo.id)

      const computeResult = raydium.cpmm.computePairAmount({
        baseIn: params.baseIn,
        amount: params.inputAmount,
        slippage: new Percent(0),
        epochInfo: (await getEpochInfo())!,
        baseReserve: rpcData.baseReserve,
        quoteReserve: rpcData.quoteReserve,
        poolInfo: {
          ...params.poolInfo,
          lpAmount: new Decimal(rpcData.lpAmount.toString()).div(10 ** rpcData.lpDecimals).toNumber()
        } as ApiV3PoolInfoStandardItemCpmm
      })
      const { execute } = await raydium.cpmm.addLiquidity({
        ...params,
        inputAmount: new BN(new Decimal(params.inputAmount).mul(10 ** params.poolInfo[baseIn ? 'mintA' : 'mintB'].decimals).toFixed(0)),
        slippage: percentSlippage,
        computeResult: {
          ...computeResult,
          liquidity: new Percent(new BN(1)).sub(percentSlippage).mul(computeResult.liquidity).quotient
        },
        txVersion,
        computeBudgetConfig
      })

      const meta = getTxMeta({
        action: 'addLiquidity',
        values: {
          amountA: formatLocaleStr(
            baseIn ? params.inputAmount : params.anotherAmount,
            params.poolInfo[baseIn ? 'mintA' : 'mintB'].decimals
          )!,
          symbolA: getMintSymbol({ mint: params.poolInfo.mintA, transformSol: true }),
          amountB: formatLocaleStr(
            baseIn ? params.anotherAmount : params.inputAmount,
            params.poolInfo[baseIn ? 'mintB' : 'mintA'].decimals
          )!,
          symbolB: getMintSymbol({ mint: params.poolInfo.mintB, transformSol: true })
        }
      })

      return execute()
        .then(({ txId, signedTx }) => {
          txStatusSubject.next({
            txId,
            ...meta,
            signedTx,
            mintInfo: [params.poolInfo.mintA, params.poolInfo.mintB],
            onError,
            onConfirmed: params.onConfirmed
          })
          onSent?.()
          return txId
        })
        .catch((e) => {
          onError?.()
          toastSubject.next({ ...meta, txError: e })
          return ''
        })
        .finally(onFinally)
    },

    removeCpmmLiquidityAct: async ({ onSent, onError, onFinally, ...params }) => {
      const { raydium, txVersion } = useAppStore.getState()

      if (!raydium) return ''
      const { poolInfo, lpAmount, amountA, amountB } = params
      const computeBudgetConfig = await getComputeBudgetConfig()
      const { execute } = await raydium.cpmm.withdrawLiquidity({
        poolInfo,
        lpAmount: new BN(lpAmount),
        slippage: new Percent((get().slippage * 10000).toFixed(0), 10000),
        txVersion,
        computeBudgetConfig
      })

      const meta = getTxMeta({
        action: 'removeLiquidity',
        values: {
          amountA: formatLocaleStr(amountA, params.poolInfo.mintA.decimals)!,
          symbolA: getMintSymbol({ mint: params.poolInfo.mintA, transformSol: true }),
          amountB: formatLocaleStr(amountB, params.poolInfo.mintB.decimals)!,
          symbolB: getMintSymbol({ mint: params.poolInfo.mintB, transformSol: true })
        }
      })

      return execute()
        .then(({ txId, signedTx }) => {
          txStatusSubject.next({ txId, ...meta, signedTx, mintInfo: [params.poolInfo.mintA, params.poolInfo.mintB], onError })
          onSent?.()
          return txId
        })
        .catch((e) => {
          onError?.()
          toastSubject.next({ ...meta, txError: e })
          return ''
        })
        .finally(onFinally)
    },

    createPoolAct: async ({ pool, baseAmount, quoteAmount, startTime, onSent, onError, onFinally, onConfirmed }) => {
      const { raydium, programIdConfig, txVersion } = useAppStore.getState()
      if (!raydium) return ''
      const computeBudgetConfig = await getComputeBudgetConfig()

      const { execute, extInfo } = await raydium.cpmm.createPool({
        programId: programIdConfig.CREATE_CPMM_POOL_PROGRAM,
        poolFeeAccount: programIdConfig.CREATE_CPMM_POOL_FEE_ACC,
        feeConfig: pool.feeConfig,
        mintA: pool.mintA,
        mintB: pool.mintB,
        mintAAmount: new BN(baseAmount),
        mintBAmount: new BN(quoteAmount),
        startTime: new BN((startTime ? Number(startTime) : Date.now() + 60 * 1000) / 1000),
        ownerInfo: {
          useSOLBalance: true
        },
        associatedOnly: false,
        txVersion,
        computeBudgetConfig
      })

      const meta = getTxMeta({
        action: 'createPool',
        values: {
          mintA: getMintSymbol({ mint: pool.mintA, transformSol: true }),
          mintB: getMintSymbol({ mint: pool.mintB, transformSol: true })
        }
      })

      const handleConfirmed = () => {
        onConfirmed?.()
        set({ newCreatedPool: extInfo.address })
      }

      return execute()
        .then(({ txId, signedTx }) => {
          txStatusSubject.next({
            txId,
            ...meta,
            signedTx,
            mintInfo: [pool.mintA, pool.mintB],
            onSent,
            onError,
            onConfirmed: handleConfirmed
          })
          return txId
        })
        .catch((e) => {
          onError?.()
          toastSubject.next({ txError: e, ...meta })
          return ''
        })
        .finally(onFinally)
    },

    lockCpmmLpAct: async ({ poolInfo, lpAmount, ...txCallback }) => {
      const { raydium, txVersion, connection, wallet } = useAppStore.getState()
      if (!raydium || !connection) return ''

      const { execute, extInfo } = await raydium.cpmm.lockLp({
        poolInfo,
        lpAmount,
        withMetadata: true,
        computeBudgetConfig: await getComputeBudgetConfig(),
        getEphemeralSigners: wallet ? await getEphemeralSigners(wallet) : undefined,
        txVersion
      })

      const meta = getTxMeta({
        action: 'lockLp',
        values: {
          position: `${new Decimal(lpAmount.toString()).div(10 ** poolInfo.lpMint.decimals).toString()} ${getMintSymbol({
            mint: poolInfo.mintA,
            transformSol: true
          })}-${getMintSymbol({
            mint: poolInfo.mintB,
            transformSol: true
          })} LP`
        }
      })

      return execute()
        .then(({ txId, signedTx }) => {
          txStatusSubject.next({
            txId,
            ...meta,
            signedTx,
            mintInfo: [poolInfo.mintA, poolInfo.mintB],
            ...txCallback,
            onSent: () => txCallback.onSent?.(extInfo as CpmmLockExtInfo)
          })
          return txId
        })
        .catch((e) => {
          txCallback.onError?.()
          toastSubject.next({ txError: e, ...meta })
          return ''
        })
        .finally(() => txCallback.onFinally?.(extInfo as CpmmLockExtInfo))
    },

    harvestLockCpmmLpAct: async ({ poolInfo, nftMint, lpFeeAmount, ...txCallback }) => {
      const { raydium, txVersion, connection } = useAppStore.getState()
      if (!raydium || !connection) return ''

      const { execute } = await raydium.cpmm.harvestLockLp({
        poolInfo,
        nftMint,
        lpFeeAmount,
        txVersion
      })

      const meta = getTxMeta({
        action: 'harvestLock',
        values: {
          mintA: getMintSymbol({ mint: poolInfo.mintA, transformSol: true }),
          mintB: getMintSymbol({ mint: poolInfo.mintB, transformSol: true })
        }
      })

      return execute()
        .then(({ txId, signedTx }) => {
          txStatusSubject.next({
            txId,
            ...meta,
            signedTx,
            mintInfo: [poolInfo.mintA, poolInfo.mintB],
            ...txCallback,
            onConfirmed: () => {
              txCallback.onConfirmed?.()
              setTimeout(() => useTokenAccountStore.setState({ refreshCpmmPositionTag: Date.now() }), 500)
            }
          })
          return txId
        })
        .catch((e) => {
          txCallback.onError?.()
          toastSubject.next({ txError: e, ...meta })
          return ''
        })
        .finally(txCallback.onFinally)
    },

    computePairAmount: async ({ pool, amount, baseIn, baseReserve, quoteReserve }) => {
      const { raydium, programIdConfig, getEpochInfo } = useAppStore.getState()
      if (!raydium)
        return {
          output: '0',
          maxOutput: '0',
          minOutput: '0',
          liquidity: new BN(0)
        }

      const isCpmm = pool.programId === programIdConfig.CREATE_CPMM_POOL_PROGRAM.toBase58()
      const params = {
        poolInfo: pool,
        amount,
        baseIn,
        slippage: new Percent((get().slippage * 10000).toFixed(0), 10000)
      }

      const r = isCpmm
        ? raydium.cpmm.computePairAmount({
            ...params,
            slippage: new Percent(0),
            epochInfo: (await getEpochInfo())!,
            poolInfo: params.poolInfo as ApiV3PoolInfoStandardItemCpmm,
            baseReserve,
            quoteReserve
          })
        : raydium.liquidity.computePairAmount({
            ...params,
            poolInfo: {
              ...params.poolInfo,
              mintAmountA: new Decimal(baseReserve.toString()).div(10 ** pool.mintA.decimals).toNumber(),
              mintAmountB: new Decimal(quoteReserve.toString()).div(10 ** pool.mintB.decimals).toNumber()
            } as ApiV3PoolInfoStandardItem
          })

      const outputMint = baseIn ? pool.mintB : pool.mintA

      return {
        output:
          r.anotherAmount instanceof TokenAmount
            ? r.anotherAmount.toExact()
            : new Decimal(r.anotherAmount.amount.toString())
                .div(10 ** outputMint.decimals)
                .toDecimalPlaces(outputMint.decimals)
                .toString(),
        maxOutput:
          r.maxAnotherAmount instanceof TokenAmount
            ? r.maxAnotherAmount.toExact()
            : new Decimal(r.maxAnotherAmount.amount.toString())
                .div(10 ** outputMint.decimals)
                .toDecimalPlaces(outputMint.decimals)
                .toString(),
        minOutput:
          r.minAnotherAmount instanceof TokenAmount
            ? r.minAnotherAmount.toExact()
            : new Decimal(r.minAnotherAmount.amount.toString())
                .div(10 ** outputMint.decimals)
                .toDecimalPlaces(outputMint.decimals)
                .toString(),
        liquidity: r.liquidity
      }
    },

    getCreatePoolFeeAct: async () => {
      const { connection, programIdConfig } = useAppStore.getState()
      if (!connection || get().createPoolFee) return
      const configId = getCpmmPdaAmmConfigId(programIdConfig.CREATE_CPMM_POOL_PROGRAM, 0)
      const r = await connection.getAccountInfo(configId.publicKey, useAppStore.getState().commitment)
      if (r) {
        set({ createPoolFee: new Decimal(CpmmConfigInfoLayout.decode(r.data).createPoolFee.toString()).div(10 ** 9).toString() })
      }
    },

    fetchCpmmConfigsAct: async () => {
      const { raydium } = useAppStore.getState()
      if (Object.keys(get().cpmmFeeConfigs).length || !raydium) return
      try {
        const res = await raydium.api.getCpmmConfigs()
        const apiRes = res.reduce(
          (acc, cur) => ({
            ...acc,
            [cur.id]: cur
          }),
          {}
        )
        set({ cpmmFeeConfigs: apiRes || {} }, false, { type: 'fetchCpmmConfigsAct' })
      } catch {
        set({ cpmmFeeConfigs: {} }, false, { type: 'fetchCpmmConfigsAct' })
      }
    },

    resetComputeStateAct: () => {
      set({}, false, { type: 'resetComputeStateAct' })
    }
  }),
  'useLiquidityStore'
)
