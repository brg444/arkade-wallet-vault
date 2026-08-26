import type { BoardingSigningAdapter, Recipient, ValidatedBoardingBatch, Intent } from '@arkade-os/sdk'
import { hex } from '@scure/base'
import {
  vaultCosignerClient,
  type VaultBoardV2DeleteMessageWire,
  type VaultBoardV2RecipientWire,
  type VaultBoardV2RegisterMessageWire,
} from '../cosignerClient'
import { hexToBytes } from '../hex'
import type { VaultBoardV2Descriptor } from '../types'

function exactRecipient(recipient: Recipient): VaultBoardV2RecipientWire {
  if (
    recipient.assets?.length ||
    recipient.extensions?.length ||
    recipient.tapTree ||
    !Number.isSafeInteger(recipient.amount) ||
    Number(recipient.amount) <= 0 ||
    !recipient.address
  ) {
    throw new Error('vault-board-v2 requires one BTC-only recipient')
  }
  return { address: recipient.address, amountSats: Number(recipient.amount) }
}

function safeBatchExpiry(value: bigint): number {
  if (value <= 0n || value > BigInt(0xffffffff)) throw new Error('vault-board-v2 batch expiry is invalid')
  return Number(value)
}

function registerMessage(message: Intent.RegisterMessage): VaultBoardV2RegisterMessageWire {
  if (
    message.type !== 'register' ||
    !Array.isArray(message.onchain_output_indexes) ||
    !Array.isArray(message.cosigners_public_keys) ||
    !Number.isSafeInteger(message.valid_at) ||
    !Number.isSafeInteger(message.expire_at)
  ) {
    throw new Error('vault-board-v2 register message is invalid')
  }
  return {
    type: 'register',
    onchain_output_indexes: [...message.onchain_output_indexes],
    valid_at: message.valid_at,
    expire_at: message.expire_at,
    cosigners_public_keys: [...message.cosigners_public_keys],
  }
}

function deleteMessage(message: Intent.DeleteMessage): VaultBoardV2DeleteMessageWire {
  if (message.type !== 'delete' || !Number.isSafeInteger(message.expire_at)) {
    throw new Error('vault-board-v2 delete message is invalid')
  }
  return { type: 'delete', expire_at: message.expire_at }
}

function finalBatch(batch: ValidatedBoardingBatch) {
  const recipients = batch.expectedRecipients.map(exactRecipient)
  if (recipients.length !== 1) throw new Error('vault-board-v2 requires one validated recipient')
  return {
    batchId: batch.batchId,
    batchExpiry: safeBatchExpiry(batch.batchExpiry),
    unsignedCommitmentTx: batch.unsignedCommitmentTx,
    vtxoTree: batch.vtxoTree.map((node) => ({
      txid: node.txid,
      tx: node.tx,
      children: { ...node.children },
    })),
    expectedRecipients: recipients,
  }
}

export function createVaultBoardV2SigningAdapter(
  vaultId: string,
  descriptor: VaultBoardV2Descriptor,
): BoardingSigningAdapter {
  const publicKey = hexToBytes(descriptor.vaultBoardCosignerPub).slice(1)
  if (publicKey.length !== 32 || hex.encode(publicKey) !== descriptor.vaultBoardCosignerPub.slice(2)) {
    throw new Error('vault-board-v2 cosigner key is invalid')
  }
  return {
    publicKey,
    async prepareRegistration(request) {
      if (request.inputs.length !== 1 || request.recipients.length !== 1) {
        throw new Error('vault-board-v2 requires one boarding input and one recipient')
      }
      const input = request.inputs[0]
      if (!/^[0-9a-f]{64}$/.test(input.txid) || !Number.isSafeInteger(input.vout) || input.vout < 0) {
        throw new Error('vault-board-v2 outpoint is invalid')
      }
      return vaultCosignerClient.boarding.prepare({
        vaultId,
        inputs: [{ txid: input.txid, vout: input.vout }],
        recipients: [exactRecipient(request.recipients[0])],
      })
    },
    registerIntent(request) {
      return vaultCosignerClient.boarding.register({
        handle: request.handle,
        psbt: request.psbt,
        inputIndexes: [...request.inputIndexes],
        message: registerMessage(request.message),
      })
    },
    releaseIntent(request) {
      return vaultCosignerClient.boarding.release({
        handle: request.handle,
        psbt: request.psbt,
        inputIndexes: [...request.inputIndexes],
        message: deleteMessage(request.message),
      })
    },
    submitCommitment(request) {
      return vaultCosignerClient.boarding.final({
        handle: request.handle,
        psbt: request.psbt,
        inputIndexes: [...request.inputIndexes],
        signedForfeits: [...request.signedForfeits],
        validatedBatch: finalBatch(request.validatedBatch),
      })
    },
  }
}
