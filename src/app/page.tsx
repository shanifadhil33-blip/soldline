import messages from '../../messages/en.json';

export default function Home() {
  return (
    <main className="mx-auto max-w-3xl p-6">
      <h1 className="max-w-2xl text-2xl font-semibold leading-snug sm:text-[28px]">
        {messages.landing.headline}
      </h1>
      <p className="mt-4 text-base">{messages.landing.status}</p>
    </main>
  );
}
