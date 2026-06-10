import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { CompanyService } from '@/lib/services/company-service';

// Получить конкретную компанию с её клиентами
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;
    const company = await CompanyService.getCompanyDetails(id);

    if (!company) {
      return NextResponse.json({ success: false, error: 'Компания не найдена' }, { status: 404 });
    }

    return NextResponse.json({ success: true, company });
  } catch (error: any) {
    console.error('Error fetching company details:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при получении данных компании' }, { status: 500 });
  }
}

// Обновить компанию
export async function PUT(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;
    const { name, description, emailDomains, isActive } = await req.json();

    if (!name || name.trim() === '') {
      return NextResponse.json({ success: false, error: 'Название компании обязательно' }, { status: 400 });
    }

    const updatedCompany = await CompanyService.updateCompany(id, { name, description, emailDomains, isActive }, session.userId);
    return NextResponse.json({ success: true, company: updatedCompany });
  } catch (error: any) {
    console.error('Error updating company:', error);
    return NextResponse.json({ success: false, error: error.message || 'Ошибка при обновлении данных компании' }, { status: 400 });
  }
}

// Удалить компанию (с каскадным удалением её клиентов в 3XUI!)
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { id } = await params;
    await CompanyService.deleteCompany(id, session.userId);

    return NextResponse.json({ success: true, message: 'Компания и все её пользователи успешно удалены' });
  } catch (error: any) {
    console.error('Error deleting company:', error);
    return NextResponse.json({ success: false, error: error.message || 'Ошибка при удалении компании' }, { status: 400 });
  }
}

