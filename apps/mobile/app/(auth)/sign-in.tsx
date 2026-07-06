import { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, Alert } from 'react-native';
import { useSignIn } from '@clerk/clerk-expo';
import { useRouter } from 'expo-router';
import { SafeAreaView } from 'react-native-safe-area-context';

export default function SignInScreen() {
  const { signIn, setActive, isLoaded } = useSignIn();
  const router = useRouter();
  const [emailAddress, setEmailAddress] = useState('');
  const [password, setPassword] = useState('');

  async function onSignIn() {
    if (!isLoaded) return;
    try {
      const attempt = await signIn.create({ identifier: emailAddress, password });
      if (attempt.status === 'complete') {
        await setActive({ session: attempt.createdSessionId });
        router.replace('/(tabs)');
      } else {
        Alert.alert('Sign-in incomplete', JSON.stringify(attempt, null, 2));
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Erro desconhecido';
      Alert.alert('Falha no login', message);
    }
  }

  return (
    <SafeAreaView className="flex-1 bg-background">
      <View className="flex-1 justify-center px-8">
        <Text className="text-3xl font-semibold text-foreground">Fxl Sales</Text>
        <Text className="mt-2 text-base text-muted-foreground">Entre com sua conta</Text>

        <View className="mt-10 gap-4">
          <View>
            <Text className="text-sm font-medium text-foreground mb-2">Email</Text>
            <TextInput
              className="border border-border rounded-lg px-4 py-3 text-foreground"
              autoCapitalize="none"
              keyboardType="email-address"
              value={emailAddress}
              onChangeText={setEmailAddress}
              placeholder="voce@exemplo.com"
              placeholderTextColor="#94a3b8"
            />
          </View>
          <View>
            <Text className="text-sm font-medium text-foreground mb-2">Senha</Text>
            <TextInput
              className="border border-border rounded-lg px-4 py-3 text-foreground"
              secureTextEntry
              value={password}
              onChangeText={setPassword}
              placeholder="••••••••"
              placeholderTextColor="#94a3b8"
            />
          </View>
          <TouchableOpacity
            onPress={onSignIn}
            className="bg-primary rounded-lg py-3 items-center mt-2"
          >
            <Text className="text-primary-foreground font-semibold">Entrar</Text>
          </TouchableOpacity>
        </View>
      </View>
    </SafeAreaView>
  );
}
