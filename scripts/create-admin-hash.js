const readline = require("node:readline/promises");
const { stdin, stdout } = require("node:process");
const bcrypt = require("bcryptjs");

async function main() {
  const prompt = readline.createInterface({ input: stdin, output: stdout });
  const password = await prompt.question("Введите пароль администратора: ");
  prompt.close();

  if (password.length < 12) {
    throw new Error("Пароль должен содержать не менее 12 символов.");
  }

  console.log("\nДобавьте эту строку в ADMIN_HASH на Render:\n");
  console.log(await bcrypt.hash(password, 12));
}

main().catch((error) => {
  console.error(error.message);
  process.exitCode = 1;
});
