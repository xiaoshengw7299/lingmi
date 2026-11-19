<template>
  <div>
    <div class="panel">
      <div class="page-head">
        <div>
          <h1>管理员</h1>
          <p>超级管理员拥有全部菜单。其他账号只能看到角色勾选过的权限。</p>
        </div>
        <el-button v-if="auth.can('iam:edit')" type="primary" @click="openUser()">新建管理员</el-button>
      </div>
      <el-table :data="users">
        <el-table-column prop="username" label="用户名" min-width="120" />
        <el-table-column prop="realName" label="姓名" min-width="100" />
        <el-table-column label="角色" min-width="140">
          <template #default="{ row }">{{ row.roles?.map((r: any) => r.name).join('、') || '—' }}</template>
        </el-table-column>
        <el-table-column label="超管" width="80">
          <template #default="{ row }">{{ row.isSuperAdmin ? '是' : '' }}</template>
        </el-table-column>
        <el-table-column prop="status" label="状态" width="100" />
        <el-table-column label="操作" width="180" fixed="right">
          <template #default="{ row }">
            <el-button v-if="auth.can('iam:edit') && !row.isSuperAdmin" link type="primary" @click="openUser(row)">编辑</el-button>
            <el-button v-if="auth.can('iam:edit') && !row.isSuperAdmin" link @click="toggle(row)">
              {{ row.status === 'ACTIVE' ? '停用' : '启用' }}
            </el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <div class="panel">
      <div class="page-head">
        <div>
          <h1>角色</h1>
          <p>按菜单勾选这个角色能看、能操作的内容。改完后，该角色的管理员重新打开页面即生效。</p>
        </div>
        <el-button v-if="auth.can('iam:edit')" @click="openRole()">新建角色</el-button>
      </div>
      <el-table :data="roles">
        <el-table-column prop="code" label="编码" min-width="120" />
        <el-table-column prop="name" label="名称" min-width="120" />
        <el-table-column prop="remark" label="说明" min-width="160" />
        <el-table-column label="权限数" width="90">
          <template #default="{ row }">{{ row.permissions?.length || 0 }}</template>
        </el-table-column>
        <el-table-column label="操作" width="120" fixed="right">
          <template #default="{ row }">
            <el-button v-if="auth.can('iam:edit')" link type="primary" @click="openRole(row)">编辑权限</el-button>
          </template>
        </el-table-column>
      </el-table>
    </div>

    <el-dialog v-model="userOpen" :title="userForm.id ? '编辑管理员' : '新建管理员'" width="min(480px, 92vw)">
      <el-form label-position="top">
        <el-form-item label="用户名"><el-input v-model="userForm.username" :disabled="!!userForm.id" /></el-form-item>
        <el-form-item label="姓名"><el-input v-model="userForm.realName" /></el-form-item>
        <el-form-item :label="userForm.id ? '新密码（留空不改）' : '密码'">
          <el-input v-model="userForm.password" type="password" show-password />
        </el-form-item>
        <el-form-item label="角色">
          <el-select v-model="userForm.roleIds" multiple style="width: 100%">
            <el-option v-for="r in roles" :key="r.id" :label="r.name" :value="r.id" />
          </el-select>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="userOpen = false">取消</el-button>
        <el-button type="primary" @click="saveUser">保存</el-button>
      </template>
    </el-dialog>

    <el-dialog v-model="roleOpen" :title="roleForm.id ? '编辑角色权限' : '新建角色'" width="min(640px, 92vw)">
      <el-form label-position="top">
        <el-form-item label="编码"><el-input v-model="roleForm.code" :disabled="!!roleForm.id" /></el-form-item>
        <el-form-item label="名称"><el-input v-model="roleForm.name" /></el-form-item>
        <el-form-item label="说明"><el-input v-model="roleForm.remark" /></el-form-item>
        <el-form-item label="菜单权限">
          <div v-for="g in permGroups" :key="g.name" class="perm-group">
            <strong>{{ g.name }}</strong>
            <el-checkbox-group v-model="roleForm.permissionIds">
              <el-checkbox v-for="p in g.items" :key="p.id" :value="p.id">{{ p.name }}</el-checkbox>
            </el-checkbox-group>
          </div>
        </el-form-item>
      </el-form>
      <template #footer>
        <el-button @click="roleOpen = false">取消</el-button>
        <el-button type="primary" @click="saveRoleForm">保存</el-button>
      </template>
    </el-dialog>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { createIamUser, iamPerms, iamRoles, iamUsers, patchIamUser, saveRole } from '@/api';
import { useAuthStore } from '@/stores/auth';

const auth = useAuthStore();
const users = ref<any[]>([]);
const roles = ref<any[]>([]);
const perms = ref<any[]>([]);
const userOpen = ref(false);
const roleOpen = ref(false);
const userForm = reactive({ id: '', username: '', realName: '', password: '', roleIds: [] as string[] });
const roleForm = reactive({ id: '', code: '', name: '', remark: '', permissionIds: [] as string[] });
const permGroups = computed(() => {
  const map: Record<string, any[]> = {};
  for (const p of perms.value) (map[p.group] ||= []).push(p);
  return Object.entries(map).map(([name, items]) => ({ name, items }));
});

async function load() {
  users.value = (await iamUsers()) as any[];
  roles.value = (await iamRoles()) as any[];
  perms.value = (await iamPerms()) as any[];
}

function openUser(row?: any) {
  Object.assign(userForm, {
    id: row?.id || '',
    username: row?.username || '',
    realName: row?.realName || '',
    password: '',
    roleIds: (row?.roles || []).map((r: any) => r.id),
  });
  userOpen.value = true;
}

async function saveUser() {
  if (userForm.id) {
    await patchIamUser(userForm.id, {
      realName: userForm.realName,
      password: userForm.password || undefined,
      roleIds: userForm.roleIds,
    });
  } else {
    await createIamUser({ ...userForm });
  }
  userOpen.value = false;
  ElMessage.success('已保存');
  await load();
}

async function toggle(row: any) {
  await patchIamUser(row.id, { status: row.status === 'ACTIVE' ? 'DISABLED' : 'ACTIVE' });
  await load();
}

function openRole(row?: any) {
  Object.assign(roleForm, {
    id: row?.id || '',
    code: row?.code || '',
    name: row?.name || '',
    remark: row?.remark || '',
    permissionIds: (row?.permissions || []).map((x: any) => x.permission?.id || x.permissionId),
  });
  roleOpen.value = true;
}

async function saveRoleForm() {
  await saveRole(
    { code: roleForm.code, name: roleForm.name, remark: roleForm.remark, permissionIds: roleForm.permissionIds },
    roleForm.id || undefined,
  );
  roleOpen.value = false;
  ElMessage.success('角色已保存');
  await load();
}

onMounted(load);
</script>
