import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { ClientService } from '@/lib/services/client-service';

// 1. Получить список всех клиентов
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const serializedClients = await ClientService.getClientsList();
    return NextResponse.json({ success: true, clients: serializedClients });
  } catch (error: any) {
    console.error('Error fetching clients:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при получении списка клиентов' }, { status: 500 });
  }
}

// 2. Создать нового клиента (с атомарной регистрацией в 3XUI)
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const body = await req.json();
    const { companyId, templateId } = body;

    // Валидация входных данных
    if (!companyId) {
      return NextResponse.json({ success: false, error: 'Привязка к компании обязательна' }, { status: 400 });
    }
    if (!templateId) {
      return NextResponse.json({ success: false, error: 'Выбор шаблона VPN обязателен' }, { status: 400 });
    }

    const createRes = await ClientService.createClients(body, session.userId);

    if (!createRes.success && createRes.failed.length > 0) {
      return NextResponse.json({ 
        success: false, 
        error: `Сбой создания клиентов: ${createRes.lastError}`, 
        failed: createRes.failed 
      }, { status: 502 });
    }

    return NextResponse.json({
      success: true,
      createdCount: createRes.createdCount,
      clients: createRes.clients,
      failed: createRes.failed,
    });
  } catch (error: any) {
    console.error('Error creating client(s):', error);
    return NextResponse.json({ success: false, error: error.message || 'Ошибка при создании клиента(ов)' }, { status: 400 });
  }
}

