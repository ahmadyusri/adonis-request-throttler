import { CacheManagerContract } from '@ioc:Adonis/Addons/Adonis5-Cache'
import { RequestContract } from '@ioc:Adonis/Core/Request'
import dayjs from 'dayjs'
import ms from 'ms'

import {
	ClientRecognizerContract,
	ThrottleConfig,
	RequestThrottlerManagerContract,
	VisitorData,
	VerificationResult,
} from '@ioc:Adonis/Addons/RequestThrottler'

export default class RequestThrottlerManager implements RequestThrottlerManagerContract {
	protected cache: CacheManagerContract
	protected clientRecognizer: ClientRecognizerContract

	constructor(protected config: ThrottleConfig) {}

	private get cacheStorage(): CacheManagerContract {
		return this.cache.viaStorage(this.config.cacheStorage)
	}

	public useCacheStorage(cache: CacheManagerContract) {
		this.cache = cache
	}

	public useClientRecognizer(clientRecognizer: ClientRecognizerContract) {
		this.clientRecognizer = clientRecognizer
	}

	public async verifyClient(
		clientIdentifier,
		permittedAttemptCount?: number,
		permittedAttemptPeriod?: number,
		requestId?: string
	): Promise<VerificationResult> {
		return this.verify(clientIdentifier, permittedAttemptCount, permittedAttemptPeriod, requestId)
	}

	public async verifyRequest(
		request: RequestContract,
		permittedAttemptCount?: number,
		permittedAttemptPeriod?: number
	) {
		const clientIdentifier = await this.clientRecognizer.identifyClient(request)

		return this.verify(
			clientIdentifier,
			permittedAttemptCount,
			permittedAttemptPeriod,
			request.id()
		)
	}

	protected async verify(
		identifier: string,
		permittedAttemptCount?: number,
		permittedAttemptPeriodParam?: number,
		requestId?: string
	): Promise<VerificationResult> {
		permittedAttemptCount = permittedAttemptCount || this.config.maxAttempts
		const permittedAttemptPeriod: number =
			permittedAttemptPeriodParam || this.config.maxAttemptPeriod

		let verificationResult = true

		let initResetTime = RequestThrottlerManager.createResetTime(
			permittedAttemptPeriod,
			this.config.ttlUnits
		)
		let { attemptCount, resetTime, lastRequestId } =
			(await this.cacheStorage.get<VisitorData>(identifier)) ||
			RequestThrottlerManager.buildDataForNewVisitor(initResetTime)

		if (!this.verifyByAttemptCount(attemptCount, permittedAttemptCount)) {
			verificationResult = false
		} else {
			if (lastRequestId !== requestId || requestId === undefined) {
				resetTime = RequestThrottlerManager.createResetTime(
					permittedAttemptPeriod,
					this.config.ttlUnits
				)
				await this.cacheStorage.put<VisitorData>(
					identifier,
					{ attemptCount: attemptCount + 1, resetTime, lastRequestId: requestId },
					permittedAttemptPeriod
				)
			}
		}

		return {
			maxAttemptCount: permittedAttemptCount || this.config.maxAttempts,
			attemptCount: attemptCount + 1,
			resetTime,
			requestPermitted: verificationResult,
		}
	}

	protected verifyByAttemptCount(
		userAttemptCount: number,
		permittedAttemptCount: number | undefined
	) {
		return userAttemptCount < (permittedAttemptCount || this.config.maxAttempts)
	}

	protected static buildDataForNewVisitor(resetTime: number) {
		return { attemptCount: 0, resetTime, lastRequestId: undefined }
	}

	protected static createResetTime(permittedAttemptPeriod: number, ttlUnits: string) {
		return dayjs()
			.add(ms(`${permittedAttemptPeriod}${ttlUnits}`), 'ms')
			.unix()
	}
}
