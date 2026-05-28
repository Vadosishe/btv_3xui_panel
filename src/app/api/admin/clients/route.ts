import { NextResponse } from 'next/server';
import crypto from 'crypto';
import prisma from '@/lib/prisma';
import { getSession } from '@/lib/auth';
import { xuiAddClient, xuiDeleteClient } from '@/lib/xui';

// 1. Получить список всех клиентов
export async function GET() {
  try {
    const session = await getSession();
    if (!session) {
      return NextResponse.json({ success: false, error: 'Не авторизован' }, { status: 401 });
    }

    const clients = await prisma.client.findMany({
      include: {
        company: {
          select: { name: true },
        },
        template: {
          select: { name: true, trafficLimitGB: true, limitIp: true, durationDays: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });

    // Получаем онлайн-клиентов с 3XUI
    let onlineEmails: string[] = [];
    try {
      const { xuiGetOnlineClients } = await import('@/lib/xui');
      onlineEmails = await xuiGetOnlineClients();
    } catch (e) {
      console.warn('Failed to fetch online clients in GET clients route:', e);
    }

    // Конвертируем BigInt в строку перед сериализацией JSON
    const serializedClients = clients.map(client => ({
      ...client,
      usedTrafficBytes: client.usedTrafficBytes.toString(),
      isOnline: onlineEmails.includes(client.email),
    }));

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

    const {
      name,
      companyId,
      templateId,
      customTrafficLimitGB,
      customLimitIp,
      customExpiresAt,
      customFlow,
      customTgId,
    } = await req.json();

    // Валидация входных данных
    if (!name || name.trim() === '') {
      return NextResponse.json({ success: false, error: 'ФИО сотрудника обязательно' }, { status: 400 });
    }
    if (!companyId) {
      return NextResponse.json({ success: false, error: 'Привязка к компании обязательна' }, { status: 400 });
    }
    if (!templateId) {
      return NextResponse.json({ success: false, error: 'Выбор шаблона VPN обязателен' }, { status: 400 });
    }

    // Получаем компанию и шаблон
    const company = await prisma.company.findUnique({ where: { id: companyId } });
    const template = await prisma.template.findUnique({ where: { id: templateId } });

    if (!company) {
      return NextResponse.json({ success: false, error: 'Компания не найдена' }, { status: 404 });
    }
    if (!template) {
      return NextResponse.json({ success: false, error: 'Шаблон не найден' }, { status: 404 });
    }

    // Генерируем UUID и токены для VPN-подключения
    const clientUuid = crypto.randomUUID();
    const subToken = crypto.randomUUID();
    const clientEmail = `client_${clientUuid.slice(0, 8)}@btw.vpn`; // Уникальный email-id для 3XUI

    // Вычисляем лимиты с учетом кастомных переопределений
    const trafficLimitGB = customTrafficLimitGB !== undefined && customTrafficLimitGB !== null
      ? Number(customTrafficLimitGB)
      : template.trafficLimitGB;

    const limitIp = customLimitIp !== undefined && customLimitIp !== null
      ? Number(customLimitIp)
      : template.limitIp;

    const flow = customFlow !== undefined && customFlow !== null
      ? customFlow.trim()
      : template.flow || "";

    const tgId = customTgId !== undefined && customTgId !== null
      ? customTgId.trim()
      : "";

    // Срок действия
    let expiresAt: Date | null = null;
    if (customExpiresAt) {
      expiresAt = new Date(customExpiresAt);
    } else if (template.durationDays > 0) {
      const expDate = new Date();
      expDate.setDate(expDate.getDate() + template.durationDays);
      expiresAt = expDate;
    }

    // Переводим лимит трафика в байты для 3XUI (1 GB = 1024^3 Bytes)
    const trafficBytesLimit = trafficLimitGB > 0
      ? BigInt(trafficLimitGB) * BigInt(1024 * 1024 * 1024)
      : BigInt(0);

    // Unix timestamp в миллисекундах для 3XUI (0 - без лимита времени)
    const expiryTimeMs = expiresAt ? expiresAt.getTime() : 0;

    // Парсим инбаунды шаблона
    let inboundIds: number[] = [];
    try {
      inboundIds = JSON.parse(template.inboundIdsJson || '[]');
    } catch (e) {
      return NextResponse.json({ success: false, error: 'Ошибка структуры инбаундов в шаблоне' }, { status: 500 });
    }

    if (inboundIds.length === 0) {
      return NextResponse.json({ success: false, error: 'В выбранном шаблоне нет активных инбаундов 3XUI' }, { status: 400 });
    }

    // --- Регистрация клиента на 3XUI сервере ---
    const addedInboundIds: number[] = [];
    let isSuccess = true;
    let apiErrorMsg = '';

    for (const inboundId of inboundIds) {
      try {
        const added = await xuiAddClient(inboundId, {
          id: clientUuid,
          email: clientEmail,
          limitIp: limitIp,
          totalGB: Number(trafficBytesLimit), // В 3XUI отправляется число байт
          expiryTime: expiryTimeMs,
          enable: true,
          flow: flow,
          tgId: tgId,
        });

        if (added) {
          addedInboundIds.push(inboundId);
        } else {
          isSuccess = false;
          apiErrorMsg = `Панель 3XUI отклонила добавление в Inbound ID ${inboundId}`;
          break;
        }
      } catch (err: any) {
        isSuccess = false;
        apiErrorMsg = `Ошибка подключения к API 3XUI: ${err.message}`;
        break;
      }
    }

    // --- Откат изменений при сбое транзакции ---
    if (!isSuccess) {
      console.warn(`Failure creating client in 3XUI. Rolling back for added inbounds: [${addedInboundIds.join(', ')}]...`);
      for (const addedId of addedInboundIds) {
        try {
          await xuiDeleteClient(addedId, clientUuid);
        } catch (rollbackErr: any) {
          console.error(`Rollback failed for Inbound ID ${addedId}:`, rollbackErr.message);
        }
      }
      return NextResponse.json({ success: false, error: `Сбой создания клиента на сервере VPN: ${apiErrorMsg}` }, { status: 502 });
    }

    // --- Запись в локальную базу данных Postgres ---
    const client = await prisma.client.create({
      data: {
        name: name.trim(),
        email: clientEmail,
        vpnUuid: clientUuid,
        subscriptionToken: subToken,
        trafficLimitGB: customTrafficLimitGB !== undefined && customTrafficLimitGB !== null ? Number(customTrafficLimitGB) : null,
        limitIp: customLimitIp !== undefined && customLimitIp !== null ? Number(customLimitIp) : null,
        expiresAt: expiresAt,
        flow: customFlow !== undefined && customFlow !== null ? customFlow.trim() : null,
        tgId: customTgId !== undefined && customTgId !== null ? customTgId.trim() : null,
        companyId: companyId,
        templateId: templateId,
      },
    });

    // Логируем аудит
    await prisma.auditLog.create({
      data: {
        action: 'CREATE_CLIENT',
        details: `Создан VPN-клиент: ${client.name} (Компания: ${company.name}, Шаблон: ${template.name})`,
        adminId: session.userId,
      },
    });

    return NextResponse.json({
      success: true,
      client: {
        ...client,
        usedTrafficBytes: client.usedTrafficBytes.toString(),
      },
    });
  } catch (error: any) {
    console.error('Error creating client:', error);
    return NextResponse.json({ success: false, error: 'Ошибка при создании клиента' }, { status: 500 });
  }
}
