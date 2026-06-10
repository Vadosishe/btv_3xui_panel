import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { ClientService } from '@/lib/services/client-service';

// 1. Получить детальную информацию о клиенте + сгенерированные VPN-ссылки
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;
    const details = await ClientService.getClientDetails(id);

    if (!details) {
      return NextResponse.json({ success: false, error: 'Клиент не найден' }, { status: 404 });
    }

    return NextResponse.json({
      success: true,
      ...details,
    });
  } catch (error: any) {
    console.error('Error fetching client details:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при получении данных клиента' }, { status: 500 });
  }
}

// 2. Обновить клиента (с изменением тарифов / шаблонов на 3XUI серверах)
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;
    const body = await req.json();

    const updatedClient = await ClientService.updateClient(id, body, session.userId);

    return NextResponse.json({
      success: true,
      client: {
        ...updatedClient,
        usedTrafficBytes: updatedClient.usedTrafficBytes.toString(),
      },
    });
  } catch (error: any) {
    console.error('Error updating client:', error);
    return NextResponse.json({ success: false, error: error.message || 'Ошибка при обновлении клиента' }, { status: 400 });
  }
}

// 3. Удалить клиента
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;
    await ClientService.deleteClient(id, session.userId);

    return NextResponse.json({ success: true, message: 'Клиент успешно удален из БД и серверов VPN' });
  } catch (error: any) {
    console.error('Error deleting client:', error);
    return NextResponse.json({ success: false, error: error.message || 'Ошибка при удалении клиента' }, { status: 400 });
  }
}

