import { Home } from 'lucide-preact';
import { t } from '@/lib/i18n';

interface NotFoundPageProps {
  title?: string;
  message?: string;
  homeHref?: string;
}

export default function NotFoundPage(props: NotFoundPageProps) {
  const starBoxes = [1, 2, 3, 4];
  const stars = [1, 2, 3, 4, 5, 6, 7];

  return (
    <main className="not-found-page">
      <div className="not-found-space" aria-hidden="true">
        {starBoxes.map((box) => (
          <div key={box} className={`not-found-star-box not-found-star-box-${box}`}>
            {stars.map((star) => (
              <span key={star} className={`not-found-star not-found-star-position-${star}`} />
            ))}
          </div>
        ))}
      </div>

      <section className="not-found-shell" aria-labelledby="not-found-title">
        <div className="not-found-brand">
          <img src="/nodewarden-logo.svg" alt="NodeWarden logo" className="not-found-logo" />
          <span className="not-found-wordmark" aria-label="NodeWarden" role="img" />
        </div>

        <div className="not-found-astro-stage" aria-hidden="true">
          <div className="not-found-astronaut">
            <div className="not-found-astro-head" />
            <div className="not-found-astro-arm not-found-astro-arm-left" />
            <div className="not-found-astro-arm not-found-astro-arm-right" />
            <div className="not-found-astro-body">
              <div className="not-found-astro-panel" />
            </div>
            <div className="not-found-astro-leg not-found-astro-leg-left" />
            <div className="not-found-astro-leg not-found-astro-leg-right" />
            <div className="not-found-astro-pack" />
          </div>
        </div>

        <div className="not-found-copy">
          <div className="not-found-code">404</div>
          <h1 id="not-found-title">{props.title || t('txt_page_not_found')}</h1>
          <p>{props.message || t('txt_page_not_found_hint')}</p>
          <a className="btn btn-primary not-found-action" href={props.homeHref || '/'}>
            <Home size={14} className="btn-icon" />
            {t('txt_back_to_home')}
          </a>
        </div>
      </section>
    </main>
  );
}
