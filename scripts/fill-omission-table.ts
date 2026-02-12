/**
 * 手动填充遗漏数据表
 * 
 * 使用方法：
 * npx tsx scripts/fill-omission-table.ts
 */

import { readDB, writeDB, initializeDatabaseConnections, closeDatabaseConnections } from '../src/database/client';
import { calculateYilouDynamic } from '../src/services/omission-data';
import { getAllStatTypes } from '../src/config/stat-types';

async function fillOmissionTable() {
  try {
    console.log('正在连接数据库...');
    await initializeDatabaseConnections();
    
    console.log('检查表状态...');
    const count = await readDB.omission_data.count();
    console.log(`当前表中有 ${count} 条记录`);
    
    if (count > 0) {
      console.log('表中已有数据，是否要清空并重新填充？(y/n)');
      // 为了自动化，我们直接更新
      console.log('将使用 upsert 模式更新数据...');
    }
    
    console.log('开始动态计算遗漏值...');
    const yilou = await calculateYilouDynamic();
    console.log('计算完成！');
    
    console.log('开始填充数据...');
    const allTypes = getAllStatTypes();
    let successCount = 0;
    
    for (const type of allTypes) {
      try {
        await writeDB.omission_data.upsert({
          where: { omission_type: type },
          create: {
            omission_type: type,
            omission_count: yilou[type] || 0
          },
          update: {
            omission_count: yilou[type] || 0
          }
        });
        successCount++;
        console.log(`  ✓ ${type}: ${yilou[type] || 0}`);
      } catch (error: any) {
        console.error(`  ✗ ${type}: ${error.message}`);
      }
    }
    
    console.log(`\n完成！成功插入/更新 ${successCount}/${allTypes.length} 条记录`);
    
    // 验证
    const finalCount = await readDB.omission_data.count();
    console.log(`\n最终表中有 ${finalCount} 条记录`);
    
    // 显示前几条数据
    const samples = await readDB.omission_data.findMany({ take: 5 });
    console.log('\n示例数据：');
    samples.forEach((record: any) => {
      console.log(`  ${record.omission_type}: ${record.omission_count}`);
    });
    
  } catch (error: any) {
    console.error('填充失败:', error.message);
    console.error(error);
    process.exit(1);
  } finally {
    await closeDatabaseConnections();
    console.log('\n数据库连接已关闭');
    process.exit(0);
  }
}

fillOmissionTable();


