import { doc, setDoc, onSnapshot } from 'firebase/firestore'
import { db } from '@/lib/firebase'

export type CustomerDisplayItem = {
  nombre: string
  cantidad: number
  precioUnitario: number
  subtotal: number
  esManual?: boolean
}

export type CustomerDisplayData = {
  businessName: string
  items: CustomerDisplayItem[]
  descuento: number
  envioCosto: number
  total: number
  timestamp: number
}

const COLLECTION = 'tblDisplaySessions'

/** Writes cart data to Firestore for the customer display to read. */
export async function broadcastCart(sessionId: string, data: Omit<CustomerDisplayData, 'timestamp'>) {
  const ref = doc(db, COLLECTION, sessionId)
  await setDoc(ref, { ...data, timestamp: Date.now() })
}

/** Listens for cart data from Firestore. Returns an unsubscribe function. */
export function listenCart(
  sessionId: string,
  onData: (data: CustomerDisplayData) => void,
): () => void {
  const ref = doc(db, COLLECTION, sessionId)
  return onSnapshot(ref, (snap) => {
    if (snap.exists()) {
      onData(snap.data() as CustomerDisplayData)
    }
  })
}

/** Cleans up the session document from Firestore. */
export async function closeSession(sessionId: string) {
  try {
    const { deleteDoc } = await import('firebase/firestore')
    await deleteDoc(doc(db, COLLECTION, sessionId))
  } catch { /* ignore */ }
}
