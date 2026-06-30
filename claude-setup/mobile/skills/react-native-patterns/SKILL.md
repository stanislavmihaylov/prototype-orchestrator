---
name: react-native-patterns
description: >
  React Native + Expo patterns for this project: navigation, Zustand state,
  API calls in store actions, styling, auth token attachment, secure storage,
  platform differences, error handling, and safe area handling.
  Use when implementing mobile features.
---

# React Native Patterns (Expo Managed Workflow)

## Navigation — typed params, never string routes

Define route params in `apps/mobile/src/navigation/types.ts`:

```typescript
// apps/mobile/src/navigation/types.ts
import type { NativeStackScreenProps } from '@react-navigation/native-stack';

export type RootStackParamList = {
  Login: undefined;
  Register: undefined;
  Home: undefined;
  JournalList: undefined;
  JournalDetail: { id: string };
  CreateJournal: undefined;
  Profile: undefined;
};

// Screen prop helper
export type RootStackScreenProps<T extends keyof RootStackParamList> =
  NativeStackScreenProps<RootStackParamList, T>;
```

Always type `useNavigation`:

```typescript
import { useNavigation } from '@react-navigation/native';
import type { NativeStackNavigationProp } from '@react-navigation/native-stack';
import type { RootStackParamList } from '../../../navigation/types';

type Nav = NativeStackNavigationProp<RootStackParamList>;

export function JournalListScreen() {
  const navigation = useNavigation<Nav>();

  return (
    <TouchableOpacity onPress={() => navigation.navigate('JournalDetail', { id: entry.id })}>
      {/* ... */}
    </TouchableOpacity>
  );
}
```

Never: `navigation.navigate('journalDetail' as any)` or string literals not in the type.

## Zustand state — one slice per feature domain

```typescript
// apps/mobile/src/features/journal/stores/useJournalStore.ts
import { create } from 'zustand';
import type { JournalEntryResponse, CreateJournalEntryRequest, ApiError } from '@repo/types';

const API_BASE = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:3000';

interface JournalState {
  entries: JournalEntryResponse[];
  selectedEntry: JournalEntryResponse | null;
  status: 'idle' | 'loading' | 'error' | 'success';
  error: string | null;
}

interface JournalActions {
  fetchEntries: (getToken: () => Promise<string>) => Promise<void>;
  createEntry: (data: CreateJournalEntryRequest, getToken: () => Promise<string>) => Promise<void>;
  selectEntry: (id: string) => void;
  clear: () => void;
}

export const useJournalStore = create<JournalState & JournalActions>((set, get) => ({
  entries: [],
  selectedEntry: null,
  status: 'idle',
  error: null,

  fetchEntries: async (getToken) => {
    set({ status: 'loading', error: null });
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE}/api/journal`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });
      if (!response.ok) {
        const err: ApiError = await response.json();
        throw new Error(err.error);
      }
      const entries: JournalEntryResponse[] = await response.json();
      set({ entries, status: 'success' });
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to load entries',
      });
    }
  },

  createEntry: async (data, getToken) => {
    set({ status: 'loading', error: null });
    try {
      const token = await getToken();
      const response = await fetch(`${API_BASE}/api/journal`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(data),
      });
      if (!response.ok) {
        const err: ApiError = await response.json();
        throw new Error(err.error);
      }
      const newEntry: JournalEntryResponse = await response.json();
      // Immutable update — never mutate state directly
      set((state) => ({ entries: [newEntry, ...state.entries], status: 'success' }));
    } catch (error) {
      set({
        status: 'error',
        error: error instanceof Error ? error.message : 'Failed to create entry',
      });
    }
  },

  selectEntry: (id) => {
    const entry = get().entries.find((e) => e.id === id) ?? null;
    set({ selectedEntry: entry });
  },

  clear: () => set({ entries: [], selectedEntry: null, status: 'idle', error: null }),
}));
```

## API calls belong in store actions — never in components

```typescript
// WRONG — fetch directly in component
function JournalListScreen() {
  const [entries, setEntries] = useState([]);
  useEffect(() => {
    fetch('/api/journal').then(r => r.json()).then(setEntries);
  }, []);
}

// CORRECT — component triggers a store action
function JournalListScreen() {
  const { getCredentials } = useAuth0();
  const { entries, status, fetchEntries } = useJournalStore();

  const getToken = useCallback(async () => {
    const creds = await getCredentials();
    return creds?.accessToken ?? '';
  }, [getCredentials]);

  useEffect(() => {
    fetchEntries(getToken);
  }, [fetchEntries, getToken]);
}
```

## Auth token — always attach Bearer header

```typescript
// Pattern used in every store action that calls the backend
const { getCredentials } = useAuth0();

const getToken = async (): Promise<string> => {
  const credentials = await getCredentials();
  if (!credentials?.accessToken) {
    throw new Error('Not authenticated');
  }
  return credentials.accessToken;
};

// In the store action:
const token = await getToken();
const response = await fetch(url, {
  headers: {
    Authorization: `Bearer ${token}`,  // always attach
    'Content-Type': 'application/json',
  },
});
```

## Secure storage — Expo SecureStore for sensitive data

```typescript
import * as SecureStore from 'expo-secure-store';

// Store sensitive data
await SecureStore.setItemAsync('auth_refresh_token', refreshToken);

// Retrieve
const token = await SecureStore.getItemAsync('auth_refresh_token');

// Delete
await SecureStore.deleteItemAsync('auth_refresh_token');
```

Use SecureStore for: access tokens, refresh tokens, user session data, any PII.
Use AsyncStorage for: non-sensitive preferences only (theme preference, tutorial seen, language setting).

## Styling — always StyleSheet.create()

```typescript
// CORRECT
import { StyleSheet, View, Text } from 'react-native';

export function JournalCard({ title }: { title: string }) {
  return (
    <View style={styles.card}>
      <Text style={styles.title}>{title}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: '#FFFFFF',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  title: {
    fontSize: 16,
    fontWeight: '600',
    color: '#1A1A1A',
  },
});

// WRONG — inline style objects create new objects on every render
<View style={{ backgroundColor: '#FFF', padding: 16 }}>
```

Use theme tokens from `apps/mobile/src/constants/theme.ts`:

```typescript
// apps/mobile/src/constants/theme.ts
export const colors = {
  primary: '#4A90E2',
  background: '#FFFFFF',
  surface: '#F8F9FA',
  text: '#1A1A1A',
  textSecondary: '#6B7280',
  error: '#E53E3E',
  success: '#38A169',
  border: '#E5E7EB',
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 16,
  lg: 24,
  xl: 32,
};

export const typography = {
  heading1: { fontSize: 28, fontWeight: '700' as const },
  heading2: { fontSize: 22, fontWeight: '600' as const },
  body: { fontSize: 16, fontWeight: '400' as const },
  caption: { fontSize: 12, fontWeight: '400' as const },
};
```

## Platform differences — Platform.select()

```typescript
import { Platform, StyleSheet } from 'react-native';

const styles = StyleSheet.create({
  shadow: Platform.select({
    ios: {
      shadowColor: '#000',
      shadowOffset: { width: 0, height: 2 },
      shadowOpacity: 0.1,
      shadowRadius: 4,
    },
    android: {
      elevation: 3,
    },
    default: {},
  }),
  keyboardBehavior: Platform.select({
    ios: { behavior: 'padding' as const },
    android: { behavior: 'height' as const },
    default: { behavior: 'padding' as const },
  }),
});

// WRONG — inline conditional in JSX
<View style={Platform.OS === 'ios' ? { shadowColor: '#000' } : { elevation: 3 }} />
```

## Error handling — every action catches and sets status

```typescript
// Every async store action must:
// 1. Set status: 'loading' at start
// 2. On success: set status: 'success' + update state
// 3. On any error: set status: 'error' + error message
// 4. Never let exceptions propagate silently

fetchEntries: async (getToken) => {
  set({ status: 'loading', error: null });  // always reset error
  try {
    // ... async operation
    set({ entries, status: 'success' });
  } catch (error) {
    set({
      status: 'error',
      error: error instanceof Error ? error.message : 'An unexpected error occurred',
    });
    // Do NOT re-throw — the store owns the error state
  }
},
```

## SafeAreaView — every root screen

```typescript
// CORRECT — from react-native-safe-area-context (not from react-native)
import { SafeAreaView } from 'react-native-safe-area-context';

export function JournalListScreen() {
  return (
    <SafeAreaView style={styles.container}>
      {/* screen content */}
    </SafeAreaView>
  );
}

// For custom safe area handling (e.g., with absolute positioned elements):
import { useSafeAreaInsets } from 'react-native-safe-area-context';

export function BottomSheet() {
  const insets = useSafeAreaInsets();
  return (
    <View style={{ paddingBottom: insets.bottom + 16 }}>
      {/* content */}
    </View>
  );
}
```

## KeyboardAvoidingView — wrap forms

```typescript
import { KeyboardAvoidingView, Platform, ScrollView } from 'react-native';

export function CreateJournalScreen() {
  return (
    <SafeAreaView style={styles.container}>
      <KeyboardAvoidingView
        behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
        style={styles.flex}
      >
        <ScrollView keyboardShouldPersistTaps="handled">
          {/* form fields */}
        </ScrollView>
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}
```

## Accessibility — required on all interactive elements

```typescript
<TouchableOpacity
  onPress={handlePress}
  accessibilityRole="button"
  accessibilityLabel="Create new journal entry"
  accessibilityHint="Opens the journal entry creation form"
  style={styles.button}
>
  <Text style={styles.buttonText}>Create Entry</Text>
</TouchableOpacity>
```

Minimum touch target: 44×44 points. Ensure `hitSlop` is set on small icons:

```typescript
<TouchableOpacity hitSlop={{ top: 8, bottom: 8, left: 8, right: 8 }}>
  <Icon size={20} />
</TouchableOpacity>
```

## Button sizing — content-width vs full-width

Not all buttons should stretch to full width. Check Figma before defaulting to `width: '100%'`.

**Full-width button** (primary action at the bottom of a screen — "Submit", "Continue"):
```typescript
<TouchableOpacity style={[styles.button, { width: '100%' }]}>
  <Text>Continue</Text>
</TouchableOpacity>
```

**Content-width button** (inline action, secondary CTA, button embedded within a card):
```typescript
<TouchableOpacity style={styles.button}>
  <Text style={styles.buttonText}>View form</Text>
</TouchableOpacity>

const styles = StyleSheet.create({
  button: {
    alignSelf: 'flex-start', // or 'center' — key: do NOT set width: '100%'
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    backgroundColor: colors.primary,
  },
});
```

**Rule:** When the Figma design shows a button narrower than its container or sized to its label text, use `alignSelf: 'flex-start'` (or `'center'`) and omit `width: '100%'`.

## Continuous connector lines — no gaps between segments

When rendering a vertical progress tracker or timeline with alternating colored segments (e.g., completed green + pending grey), placing each segment in a separate `View` with default margin creates visible breaks.

**WRONG — gap appears between segments:**
```typescript
<View style={{ height: 40, backgroundColor: colors.success }} />
<View style={{ height: 40, backgroundColor: colors.border }} />
```

**CORRECT — single container, zero gap:**
```typescript
<View style={{ flexDirection: 'column' }}>
  <View style={{ height: 40, backgroundColor: colors.success, margin: 0 }} />
  <View style={{ height: 40, backgroundColor: colors.border, margin: 0 }} />
</View>
```

Nodes (circles, icons) positioned along the line must use `position: 'absolute'` centered on the line — never use margin to offset a node from the connector, as this shifts the line visually:

```typescript
<View style={{ position: 'relative' }}>
  {/* The continuous line */}
  <View style={styles.line} />
  {/* Node centered on the line */}
  <View style={[styles.node, { position: 'absolute', top: nodeY - NODE_RADIUS, left: LINE_X - NODE_RADIUS }]} />
</View>
```
