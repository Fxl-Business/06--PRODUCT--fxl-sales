import { ScrollView, View, Text } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Activity, Users } from 'lucide-react-native';
import { KPICard } from '@/components/KPICard';

export default function HomeTab() {
  return (
    <SafeAreaView className="flex-1 bg-background" edges={['left', 'right']}>
      <ScrollView contentContainerClassName="p-6 gap-4">
        <View>
          <Text className="text-2xl font-semibold text-foreground">Fxl Sales</Text>
          <Text className="mt-1 text-sm text-muted-foreground">
            Bem-vindo de volta. Comece configurando integrações.
          </Text>
        </View>

        <View className="gap-4">
          <KPICard title="Total" value="—" icon={Activity} hint="Aguardando dados" />
          <KPICard title="Ativos" value="—" icon={Users} hint="Aguardando dados" />
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}
