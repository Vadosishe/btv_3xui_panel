import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth';
import { CompanyService } from '@/lib/services/company-service';

// 1. Получить список всех компаний
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const companies = await CompanyService.getCompaniesList();
    return NextResponse.json({ success: true, companies });
  } catch (error: any) {
    console.error('Error fetching companies:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при получении списка компаний' }, { status: 500 });
  }
}

// 2. Создать новую компанию
export async function POST(req: Request) {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const { name, description, emailDomains } = await req.json();

    if (!name || name.trim() === '') {
       return NextResponse.json({ success: false, error: 'Название компании обязательно' }, { status: 400 });
    }

    const company = await CompanyService.createCompany({ name, description, emailDomains }, session.userId);
    return NextResponse.json({ success: true, company });
  } catch (error: any) {
    console.error('Error creating company:', error);
    return NextResponse.json({ success: false, error: error.message || 'Ошибка при создании компании' }, { status: 400 });
  }
}

