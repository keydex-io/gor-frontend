import { Box, Grid, GridItem, HStack, Text, VStack, useClipboard } from '@chakra-ui/react'
import { RAYMint, SOLMint } from '@raydium-io/raydium-sdk-v2'
import { PublicKey } from '@solana/web3.js'
import { useMemo, useState, useRef, useEffect } from 'react'
import { useTranslation } from 'react-i18next'

import PanelCard from '@/components/PanelCard'
import { useIsomorphicLayoutEffect } from '@/hooks/useIsomorphicLayoutEffect'
import SwapChatEmptyIcon from '@/icons/misc/SwapChatEmptyIcon'
import SwapChatIcon from '@/icons/misc/SwapChatIcon'
import SwapExchangeIcon from '@/icons/misc/SwapExchangeIcon'
import LinkIcon from '@/icons/misc/LinkIcon'
import CreditCardIcon from '@/icons/misc/CreditCardIcon'
import { useAppStore, useTokenStore } from '@/store'
import { colors } from '@/theme/cssVariables'
import { getVHExpression } from '../../theme/cssValue/getViewportExpression'
import { getSwapPairCache, setSwapPairCache } from './util'
import { SwapKlinePanelMobileDrawer } from './components/SwapKlinePanelMobileDrawer'
import { SwapKlinePanelMobileThumbnail } from './components/SwapKlinePanelMobileThumbnail'
import { SwapPanel } from './components/SwapPanel'
import { TimeType } from '@/hooks/pool/useFetchPoolKLine'
import { SlippageAdjuster } from '@/components/SlippageAdjuster'
import { getMintPriority, solToWSolToken } from '@/utils/token'
import Tooltip from '@/components/Tooltip'
import { MoonpayBuy } from '@/components/Moonpay'
import { toastSubject } from '@/hooks/toast/useGlobalToast'
import useResponsive from '@/hooks/useResponsive'
import TVChart from '@/components/TradingView/TVChart'
import TokenAvatarPair from '@/components/TokenAvatarPair'
import SwapIcon from '@/icons/misc/SwapIcon'
import dayjs from 'dayjs'
import useRefreshEpochInfo from '@/hooks/app/useRefreshEpochInfo'

export default function Swap() {
  // const { inputMint: cacheInput, outputMint: cacheOutput } = getSwapPairCache()
  const [inputMint, setInputMint] = useState<string>(PublicKey.default.toBase58())
  const [outputMint, setOutputMint] = useState<string>(RAYMint.toBase58())
  const [isPCChartShown, setIsPCChartShown] = useState<boolean>(false)
  const [isMobileChartShown, setIsMobileChartShown] = useState<boolean>(false)
  const [isChartLeft, setIsChartLeft] = useState<boolean>(true)
  const { isMobile } = useResponsive()
  const publicKey = useAppStore((s) => s.publicKey)
  const connected = useAppStore((s) => s.connected)
  const [directionReverse, setDirectionReverse] = useState<boolean>(false)
  const [selectedTimeType, setSelectedTimeType] = useState<TimeType>('15m')
  const [cacheLoaded, setCacheLoaded] = useState(false)
  const untilDate = useRef(Math.floor(Date.now() / 1000))
  const swapPanelRef = useRef<HTMLDivElement>(null)
  const klineRef = useRef<HTMLDivElement>(null)
  const { t } = useTranslation()
  const { onCopy, setValue } = useClipboard('')
  useRefreshEpochInfo(true)
  const [isBlinkReferralActive, setIsBlinkReferralActive] = useState(false)
  const solMintAddress = SOLMint.toBase58()

  const baseMint = directionReverse ? outputMint : inputMint
  const quoteMint = directionReverse ? inputMint : outputMint
  const tokenMap = useTokenStore((s) => s.tokenMap)
  const baseToken = useMemo(() => tokenMap.get(baseMint), [tokenMap, baseMint])
  const quoteToken = useMemo(() => tokenMap.get(quoteMint), [tokenMap, quoteMint])
  const [isDirectionNeedReverse, setIsDirectionNeedReverse] = useState<boolean>(false)

  useEffect(() => {
    const { inputMint: cacheInput, outputMint: cacheOutput } = getSwapPairCache()
    if (cacheInput) setInputMint(cacheInput)
    if (cacheOutput && cacheOutput !== cacheInput) setOutputMint(cacheOutput)
    setCacheLoaded(true)
  }, [])
  useEffect(() => {
    // preserve swap chart default direction on page refresh by mint priority
    if (cacheLoaded) {
      if (getMintPriority(baseMint) > getMintPriority(quoteMint)) {
        setDirectionReverse(true)
      }
    }
  }, [cacheLoaded])
  // reset directionReverse when inputMint or outputMint changed
  useIsomorphicLayoutEffect(() => {
    if (!cacheLoaded) return
    if (isDirectionNeedReverse) {
      setDirectionReverse(true)
      setIsDirectionNeedReverse(false)
    } else {
      setDirectionReverse(false)
    }

    setSwapPairCache({
      inputMint,
      outputMint
    })
  }, [inputMint, outputMint, cacheLoaded])

  useIsomorphicLayoutEffect(() => {
    if (klineRef.current) {
      const swapPanelHeight = swapPanelRef.current?.getBoundingClientRect().height
      const height = Number(swapPanelHeight) > 500 ? `${swapPanelHeight}px` : '522px'
      klineRef.current.style.height = height
    }
  }, [])

  useEffect(() => {
    // inputMint === solMintAddress || outputMint === solMintAddress ? setIsBlinkReferralActive(true) : setIsBlinkReferralActive(false)
    setIsBlinkReferralActive(true)
    const def = PublicKey.default.toString()
    const _inputMint = inputMint === def ? 'sol' : inputMint
    const _outputMint = outputMint === def ? 'sol' : outputMint
    const href = `https://raydium.io/swap/?inputMint=${_inputMint}&outputMint=${_outputMint}`
    const walletAddress = publicKey?.toBase58()
    const copyUrl = connected ? href + `&referrer=${walletAddress}` : href
    setValue(copyUrl)
  }, [inputMint, outputMint, connected, publicKey])

  return (
    <VStack
      mx={['unset', 'auto']}
      mt={[0, getVHExpression([0, 800], [32, 1300])]}
      width={!isMobile && isPCChartShown ? 'min(100%, 1300px)' : undefined}
    >
      <Grid
        width="full"
        gridTemplate={[
          `
            "controls" auto
            "panel" auto
            "kline" auto / auto
          `,
          isPCChartShown
            ? isChartLeft
              ? `". controls" auto "kline  panel" auto / 1.5fr 1fr`
              : `". controls" auto "panel kline" auto / 1fr 1.5fr`
            : `"controls" auto "panel" auto / auto`
        ]}
        columnGap={[3, isPCChartShown ? 4 : 0]}
        rowGap={2}
      >
        <GridItem gridArea="controls">
          <HStack justifyContent="space-between" my={[1, 0]}>
            <div></div>
            <HStack>
              <SlippageAdjuster />
              <Tooltip
                label={t('swap.blink_referral_desc', {
                  symbol: outputMint === solMintAddress ? tokenMap.get(inputMint)?.symbol : tokenMap.get(outputMint)?.symbol
                })}
              >
                <Box
                  cursor="pointer"
                  opacity={isBlinkReferralActive ? 1 : 0.6}
                  onClick={() => {
                    if (isBlinkReferralActive) {
                      onCopy()
                      toastSubject.next({
                        status: 'success',
                        title: t('common.copy_success')
                      })
                    }
                  }}
                >
                  <LinkIcon />
                </Box>
              </Tooltip>

              {!isMobile && isPCChartShown && (
                <Box
                  cursor="pointer"
                  onClick={() => {
                    setIsChartLeft((b) => !b)
                  }}
                >
                  <SwapExchangeIcon />
                </Box>
              )}
              <Box
                cursor="pointer"
                onClick={() => {
                  if (!isMobile) {
                    setIsPCChartShown((b) => !b)
                  } else {
                    setIsMobileChartShown(true)
                  }
                }}
              >
                {isMobile || isPCChartShown ? (
                  <SwapChatIcon />
                ) : (
                  <Box color={colors.textSecondary}>
                    <SwapChatEmptyIcon />
                  </Box>
                )}
              </Box>
            </HStack>
          </HStack>
        </GridItem>
        <GridItem ref={swapPanelRef} gridArea="panel">
          <PanelCard p={[3, 6]} flexGrow={['1', 'unset']}>
            <SwapPanel
              onInputMintChange={setInputMint}
              onOutputMintChange={setOutputMint}
              // onDirectionNeedReverse={() => setIsDirectionNeedReverse((b) => !b)}
            />
          </PanelCard>
        </GridItem>

        <GridItem gridArea="kline" {...(isMobile ? { mb: 3 } : {})} overflow="hidden">
          <PanelCard ref={klineRef} p={[3, 3]} gap={4} height="100%" {...(isMobile || !isPCChartShown ? { display: 'none' } : {})}>
            <HStack spacing={2}>
              <TokenAvatarPair token1={baseToken} token2={quoteToken} />
              <HStack>
                <Text fontSize="20px" fontWeight="500">
                  {baseToken?.symbol} / {quoteToken?.symbol}
                </Text>
                <Box cursor="pointer" onClick={() => setDirectionReverse((b) => !b)}>
                  <SwapIcon />
                </Box>
                <Text fontSize="sm" color={colors.textTertiary}>
                  {dayjs().utc().format('YY/MM/DD HH:MM')}
                </Text>
              </HStack>
            </HStack>
            <TVChart
              id="swap-tv-chart"
              height="100%"
              birdeye
              poolId={`${baseToken ? solToWSolToken(baseToken).address : ''}_${quoteToken ? solToWSolToken(quoteToken).address : ''}`}
              mintBInfo={quoteToken}
            />
            {/* <SwapKlinePanel
              untilDate={untilDate.current}
              baseToken={baseToken}
              quoteToken={quoteToken}
              timeType={selectedTimeType}
              onDirectionToggle={() => setDirectionReverse((b) => !b)}
              onTimeTypeChange={setSelectedTimeType}
            /> */}
          </PanelCard>
          {isMobile && (
            <PanelCard
              p={[3, 6]}
              gap={0}
              onClick={() => {
                setIsMobileChartShown(true)
              }}
              height="100%"
            >
              <SwapKlinePanelMobileThumbnail
                untilDate={untilDate.current}
                baseToken={baseToken}
                quoteToken={quoteToken}
                // onDirectionToggle={() => setDirectionReverse((b) => !b)}
                // onTimeTypeChange={setSelectedTimeType}
              />
              <SwapKlinePanelMobileDrawer
                untilDate={untilDate.current}
                isOpen={isMobileChartShown}
                onClose={() => setIsMobileChartShown(false)}
                baseToken={baseToken}
                quoteToken={quoteToken}
                timeType={selectedTimeType}
                onDirectionToggle={() => setDirectionReverse((b) => !b)}
                onTimeTypeChange={setSelectedTimeType}
              />
            </PanelCard>
          )}
        </GridItem>
      </Grid>
    </VStack>
  )
}
